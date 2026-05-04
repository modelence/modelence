'use client';

import React, { useState, type ReactNode } from 'react';
import {
  QueryClient,
  QueryClientProvider,
  HydrationBoundary,
  type DehydratedState,
} from '@tanstack/react-query';
import { connectModelenceQueryClient } from './query';

const SSR_QUERY_STATE_SCRIPT_ID = '__MODELENCE_QUERY_STATE__';

function readDehydratedState(): DehydratedState | undefined {
  if (typeof document === 'undefined') {
    return undefined;
  }

  const node = document.getElementById(SSR_QUERY_STATE_SCRIPT_ID);
  if (!node || !node.textContent) {
    return undefined;
  }

  try {
    return JSON.parse(node.textContent) as DehydratedState;
  } catch (e) {
    console.error('Modelence: failed to parse SSR query state', e);
    return undefined;
  }
}

interface ModelenceQueryProviderProps {
  children: ReactNode;
  /**
   * Optional pre-created `QueryClient`. When provided, the provider does not
   * create its own — used during SSR so the framework can dehydrate the
   * exact cache that was populated during render.
   */
  client?: QueryClient;
  /**
   * Pre-supplied dehydrated state. Used during initial client hydration when
   * the framework decoded `__MODELENCE_QUERY_STATE__` ahead of mount.
   * Defaults to whatever `__MODELENCE_QUERY_STATE__` contains.
   */
  dehydratedState?: DehydratedState;
}

/**
 * Wraps the app with TanStack Query's `QueryClientProvider` and
 * `HydrationBoundary`, auto-connects Modelence's live-query subscription
 * manager to the resulting `QueryClient`, and (when SSR is enabled) picks
 * up server-rendered cache state from the `__MODELENCE_QUERY_STATE__`
 * script tag.
 *
 * Mounted automatically by `renderApp()` for both CSR and SSR apps.
 * Most users never need to import this directly.
 */
export function ModelenceQueryProvider({
  children,
  client,
  dehydratedState,
}: ModelenceQueryProviderProps) {
  const [internalClient] = useState(() => {
    const qc =
      client ??
      new QueryClient({
        defaultOptions: {
          queries: {
            // Avoid an immediate refetch on the client right after hydration.
            staleTime: 60 * 1000,
          },
        },
      });
    // Wire the live-query subscription manager to this QueryClient. No-op on
    // the server (websockets don't run during SSR). Idempotent for the same
    // client, so StrictMode double-invocation is safe.
    if (typeof window !== 'undefined') {
      connectModelenceQueryClient(qc);
    }
    return qc;
  });

  const state = dehydratedState ?? readDehydratedState();

  return (
    <QueryClientProvider client={internalClient}>
      <HydrationBoundary state={state}>{children}</HydrationBoundary>
    </QueryClientProvider>
  );
}
