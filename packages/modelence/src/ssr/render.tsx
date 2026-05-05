import React from 'react';
import { renderToPipeableStream } from 'react-dom/server';
import { Writable } from 'node:stream';
import { QueryClient, dehydrate, type DehydratedState } from '@tanstack/react-query';
import { AppProvider } from '../client/AppProvider';
import { ModelenceQueryProvider } from '../client/queryProvider';
import { getSsrContext, runWithSsrContext } from './context';
import { runMethod } from '../methods';
import { sanitizeResult, getResponseTypeMap, reviveResponseTypes } from '../methods/serialize';
import type { Context } from '../methods/types';
import {
  _parseSessionUser,
  _setSsrSessionResolver,
  type SessionInitPayload,
} from '../client/session';
import { _setSsrConfigResolver } from '../config/client';
import type { ConfigKey, Configs } from '../config/types';
import type { SsrRouter } from '../client/renderApp';

let resolversInstalled = false;
function ensureSsrResolversInstalled() {
  if (resolversInstalled) {
    return;
  }
  resolversInstalled = true;

  _setSsrSessionResolver(() => {
    const ctx = getSsrContext();
    if (!ctx) {
      return null;
    }
    return _parseSessionUser(ctx.session.user);
  });

  _setSsrConfigResolver((key: ConfigKey) => {
    const ctx = getSsrContext();
    if (!ctx) {
      return undefined;
    }
    return ctx.session.configs[key]?.value;
  });
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

  const sessionRaw = await runMethod('_system.session.init', {}, callContext);
  const sessionSanitized = sanitizeResult(sessionRaw) as object;
  const sessionTypeMap = getResponseTypeMap(sessionSanitized);
  const sessionPayload = reviveResponseTypes(
    sessionSanitized,
    sessionTypeMap ?? undefined
  ) as SessionInitPayload;

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
    () => renderToString(tree)
  );

  const dehydratedState: DehydratedState = dehydrate(queryClient);
  queryClient.clear();

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
        console.error('SSR render error:', error);
      },
    });
  });
}
