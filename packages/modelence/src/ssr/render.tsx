import React from 'react';
import { renderToPipeableStream } from 'react-dom/server';
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
