import React from 'react';
import { renderToPipeableStream } from 'react-dom/server';
import { Writable } from 'node:stream';
import { QueryClient, dehydrate, type DehydratedState } from '@tanstack/react-query';
import { AppProvider } from '../client/AppProvider';
import { ModelenceQueryProvider } from '../client/queryProvider';
import { runWithSsrContext } from './context';
import { runMethod } from '../methods';
import { sanitizeResult, getResponseTypeMap, reviveResponseTypes } from '../methods/serialize';
import type { Context } from '../methods/types';
import type { SessionInitPayload } from '../client/session';
import type { SsrRouter } from '../client/renderApp';

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
  /**
   * Router wrapper from the user's `renderApp(...)` snapshot. Receives
   * the inbound request URL as `location` and is expected to wrap `children`
   * in a `<StaticRouter>` (or equivalent) so React Router only renders the
   * matched page during SSR.
   */
  router?: SsrRouter;
  /**
   * Inbound request URL (path + search) for routing. Required when `router`
   * is provided.
   */
  location?: string;
};

/**
 * Render the user's React tree to an HTML string, prefetching session/config
 * and any data declared via `useSuspenseQuery`. Returns the markup plus two
 * JSON state strings the caller must inline as script tags so the client
 * can hydrate without a flash of loading state and without re-fetching.
 */
export async function renderSsrTree(options: SsrRenderOptions): Promise<SsrRenderResult> {
  const { callContext, loadingElement, routesElement, router, location } = options;

  // Preload session/config in-process — same code path the client hits.
  const sessionRaw = await runMethod('_system.session.init', {}, callContext);
  const sessionSanitized = sanitizeResult(sessionRaw) as object;
  const sessionTypeMap = getResponseTypeMap(sessionSanitized);
  // Revive on the server so the structure we render with matches the client.
  const sessionPayload = reviveResponseTypes(
    sessionSanitized,
    sessionTypeMap ?? undefined
  ) as SessionInitPayload;

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // dehydrate() only includes successful queries by default; that's fine.
        retry: false,
      },
    },
  });

  const routedTree = router ? router({ children: routesElement, location }) : routesElement;

  const tree = (
    <AppProvider loadingElement={loadingElement}>
      <ModelenceQueryProvider client={queryClient}>{routedTree}</ModelenceQueryProvider>
    </AppProvider>
  );

  const html = await runWithSsrContext({ callContext, queryClient }, () => renderToString(tree));

  const dehydratedState: DehydratedState = dehydrate(queryClient);

  return {
    html,
    sessionState: JSON.stringify({ session: sessionPayload }),
    queryState: JSON.stringify(dehydratedState),
  };
}

function renderToString(tree: React.ReactElement): Promise<string> {
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
        // Errors inside Suspense boundaries are reported here too. We don't
        // reject — onAllReady or onShellError covers terminal cases — but
        // we surface the error so the user sees it in dev.
        console.error('SSR render error:', error);
      },
    });
  });
}
