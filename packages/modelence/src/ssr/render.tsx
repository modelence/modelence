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
  // Idempotent — safe to call repeatedly. Re-installs the framework's own
  // resolvers if they were swapped out (tests, future reload code).
  _setSsrSessionResolver(sessionResolver);
  _setSsrConfigResolver(configResolver);
}

export type SsrRenderResult = {
  html: string;
  /** Inline as <script id="__MODELENCE_STATE__">…</script> */
  sessionState: string;
  /** Inline as <script id="__MODELENCE_QUERY_STATE__">…</script> */
  queryState: string;
};

export type SsrRenderOptions = {
  callContext: Context;
  loadingElement: React.ReactNode;
  routesElement: React.ReactNode;
  router?: SsrRouter;
  location?: string;
};

export type SsrStreamHandle = {
  /** Session bootstrap payload — safe to inline before the React shell flushes. */
  sessionState: string;
  /**
   * Pipe React's HTML stream into the response. Resolves once every Suspense
   * boundary has settled and the stream has finished writing.
   */
  pipe: (destination: Writable) => Promise<void>;
  /**
   * Read the dehydrated query state. Only call AFTER `pipe()` resolves —
   * queries that resolve mid-stream populate the cache during render.
   */
  getQueryState: () => string;
};

export type SsrStreamOptions = SsrRenderOptions & {
  /**
   * Called once React has flushed the shell (head + above-fallback content)
   * and the stream is ready to pipe. The framework uses this hook to write
   * the opening template + state scripts before piping React's HTML.
   */
  onShellReady?: () => void;
  /** Non-fatal SSR errors (Suspense fallbacks, etc.). */
  onError?: (error: unknown) => void;
};

export async function renderSsrTree(options: SsrRenderOptions): Promise<SsrRenderResult> {
  const { callContext, loadingElement, routesElement, router, location } = options;

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
        // Per-request client; release cache + timers immediately after dehydrate.
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

  const html = await runWithSsrContext(
    {
      callContext,
      queryClient,
      session: {
        user: sessionPayload.user,
        configs: (sessionPayload.configs as Configs) ?? {},
      },
    },
    () => renderToString(tree, location)
  );

  // Safe to dehydrate + clear here: `onAllReady` waits for every Suspense
  // boundary to settle before resolving, so all in-flight queries have
  // populated the cache by this point.
  const dehydratedState: DehydratedState = dehydrate(queryClient);
  queryClient.clear();

  return {
    html,
    sessionState: JSON.stringify({ session: sessionPayload }),
    queryState: JSON.stringify(dehydratedState),
  };
}

/**
 * Streaming variant of {@link renderSsrTree}. Returns a handle that lets the
 * caller flush a template prelude (head + opening shell) as soon as the
 * React shell is ready, pipe the React HTML stream into the response, then
 * append the dehydrated query state once streaming completes.
 *
 * This is what enables fast First Contentful Paint: the browser receives the
 * <head> (with CSS <link> tags) immediately, starts the stylesheet fetch in
 * parallel with the HTML stream, and paints the streamed shell with styles
 * applied — instead of the dev-mode FOUC caused by JS-injected CSS.
 */
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
  // The shell-ready promise resolves with the PipeableStream as soon as React
  // has rendered above-fallback content. Errors during the shell render
  // reject it so the caller can fall back to a static response.
  const shellReady = new Promise<PipeableStream>((resolve, reject) => {
    // Run the render inside the SSR context so server-rendered components
    // can resolve session/config/query state from the per-request scope.
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

  // Surface shell errors synchronously by awaiting before returning the handle.
  await shellReady;

  let queryStateJson: string | null = null;

  const pipe = (destination: Writable): Promise<void> => {
    return new Promise((resolve, reject) => {
      if (!streamRef) {
        reject(new Error('SSR stream was not initialized'));
        return;
      }

      // react-dom calls `.end()` on the destination it pipes into. We need to
      // keep writing AFTER React is done (epilogue + query state script), so
      // we wrap the real destination in a pass-through Writable whose `end()`
      // flushes pending data but does NOT close the underlying response.
      const passthrough = new Writable({
        write(chunk, _encoding, callback) {
          destination.write(chunk, (err) => callback(err ?? undefined));
        },
        final(callback) {
          // Triggered by react-dom's `destination.end()`. Resolve the pipe
          // promise so the caller can write the epilogue, but leave the real
          // response open.
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

      passthrough.on('error', reject);
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

function renderToString(tree: React.ReactElement, location: string | undefined): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const writable = new Writable({
      write(chunk, _encoding, callback) {
        buffer += chunk.toString();
        callback();
      },
    });

    const { pipe } = renderToPipeableStream(tree, {
      onAllReady() {
        writable.on('finish', () => resolve(buffer));
        writable.on('error', reject);
        pipe(writable);
      },
      onShellError(error) {
        reject(error);
      },
      onError(error) {
        // Non-fatal recoverable errors (Suspense fallbacks, etc.). React still
        // ships HTML, but repeated occurrences can mask real bugs — log with
        // request URL for telemetry follow-up.
        console.error('SSR onError (non-fatal):', { location, error });
      },
    });
  });
}
