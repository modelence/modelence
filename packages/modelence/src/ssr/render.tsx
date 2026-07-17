import React from 'react';
import { renderToPipeableStream, type PipeableStream } from 'react-dom/server';
import { Writable } from 'node:stream';
import { QueryClient, dehydrate, type DehydratedState } from '@tanstack/react-query';
import { AppProvider } from '../client/AppProvider';
import { ModelenceQueryProvider } from '../client/queryProvider';
import { getSsrContext, runWithSsrContext } from './context';
import { callInProcessMethod } from './callInProcess';
import type { Context } from '../methods/types';
import {
  _parseSessionUser,
  _setSsrSessionResolver,
  type SessionInitPayload,
} from '../client/session';
import { _setSsrConfigResolver } from '../config/client';
import type { ConfigKey, Configs } from '../config/types';
import type { SsrRouter } from '../client/renderApp';

const sessionResolver = () => {
  const ctx = getSsrContext();
  if (!ctx) {
    return null;
  }
  return _parseSessionUser(ctx.session.user);
};

const configResolver = (key: ConfigKey) => {
  const ctx = getSsrContext();
  if (!ctx) {
    return undefined;
  }
  return ctx.session.configs[key]?.value;
};

function ensureSsrResolversInstalled() {
  _setSsrSessionResolver(sessionResolver);
  _setSsrConfigResolver(configResolver);
}

export type SsrRenderOptions = {
  callContext: Context;
  loadingElement: React.ReactNode;
  routesElement: React.ReactNode;
  router?: SsrRouter;
  location?: string;
};

export type SsrStreamHandle = {
  /** Session bootstrap payload — inline before the shell flushes. */
  sessionState: string;
  /** Pipe React's HTML into `destination`. Resolves when streaming finishes. */
  pipe: (destination: Writable) => Promise<void>;
  /** Dehydrated query state. Only call after `pipe()` resolves. */
  getQueryState: () => string;
};

export type SsrStreamOptions = SsrRenderOptions & {
  /** Fires when the shell is flushed; caller writes prelude + state here. */
  onShellReady?: () => void;
  /** Non-fatal SSR errors (Suspense fallbacks, etc.). */
  onError?: (error: unknown) => void;
};

export async function renderSsrTreeStream(options: SsrStreamOptions): Promise<SsrStreamHandle> {
  const { callContext, loadingElement, routesElement, router, location, onShellReady, onError } =
    options;

  ensureSsrResolversInstalled();

  const sessionPayload = await callInProcessMethod<SessionInitPayload>(
    '_system.session.init',
    {},
    callContext
  );

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  });

  const routedTree = router ? router({ children: routesElement, location }) : routesElement;
  const tree = (
    <AppProvider loadingElement={loadingElement}>
      <ModelenceQueryProvider client={queryClient}>{routedTree}</ModelenceQueryProvider>
    </AppProvider>
  );

  let streamRef: PipeableStream | null = null;
  // Resolves with the stream once React renders above-fallback content;
  // rejects on shell errors so the caller can fall back to a static response.
  const shellReady = new Promise<PipeableStream>((resolve, reject) => {
    // Run the render inside the SSR context so components can resolve
    // session/config/query state from the per-request scope.
    runWithSsrContext(
      {
        callContext,
        queryClient,
        session: {
          user: sessionPayload.user,
          configs: (sessionPayload.configs as Configs) ?? {},
        },
      },
      () => {
        const stream = renderToPipeableStream(tree, {
          onShellReady() {
            streamRef = stream;
            onShellReady?.();
            resolve(stream);
          },
          onShellError(error) {
            reject(error);
          },
          onError(error) {
            onError?.(error);
          },
        });
        return stream;
      }
    );
  });

  // Await so shell errors surface before the caller starts piping.
  await shellReady;

  let queryStateJson: string | null = null;

  const pipe = (destination: Writable): Promise<void> => {
    return new Promise((resolve, reject) => {
      if (!streamRef) {
        reject(new Error('SSR stream was not initialized'));
        return;
      }

      // react-dom calls `destination.end()` when done. The caller still needs
      // to write the epilogue + query state, so wrap with a passthrough whose
      // `final()` resolves the pipe promise without closing the response.
      const passthrough = new Writable({
        write(chunk, _encoding, callback) {
          destination.write(chunk, (err) => callback(err ?? undefined));
        },
        final(callback) {
          try {
            const dehydratedState: DehydratedState = dehydrate(queryClient);
            queryStateJson = JSON.stringify(dehydratedState);
          } finally {
            queryClient.clear();
          }
          callback();
          resolve();
        },
      });

      passthrough.on('error', (err) => {
        destination.destroy(err);
        reject(err);
      });
      destination.on('error', reject);

      streamRef.pipe(passthrough);
    });
  };

  return {
    sessionState: JSON.stringify({ session: sessionPayload }),
    pipe,
    getQueryState: () => {
      if (queryStateJson === null) {
        throw new Error('getQueryState() called before stream finished');
      }
      return queryStateJson;
    },
  };
}
