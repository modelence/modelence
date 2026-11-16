'use client';

import { useState, type ReactNode } from 'react';
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

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60 * 1000,
      },
    },
  });
}

let browserQueryClient: QueryClient | null = null;

/*
  In the browser, every mount gets the same client. In development StrictMode runs
  the useState initializer twice. With a new client per call, React would render
  the first client while the second one stayed connected, so live-query updates
  went to a client nothing reads. On the server, each render gets its own client
  so data is never shared between requests.
*/
function getDefaultQueryClient(): QueryClient {
  if (typeof window === 'undefined') {
    return createQueryClient();
  }
  browserQueryClient ??= createQueryClient();
  return browserQueryClient;
}

/** @internal Resets the shared browser client between tests. */
export function _resetBrowserQueryClient() {
  browserQueryClient = null;
}

interface ModelenceQueryProviderProps {
  children: ReactNode;
  client?: QueryClient;
  dehydratedState?: DehydratedState;
}

export function ModelenceQueryProvider({
  children,
  client,
  dehydratedState,
}: ModelenceQueryProviderProps) {
  const [internalClient] = useState(() => {
    const qc = client ?? getDefaultQueryClient();
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
