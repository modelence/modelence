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
  client?: QueryClient;
  dehydratedState?: DehydratedState;
}

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
            staleTime: 60 * 1000,
          },
        },
      });
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
