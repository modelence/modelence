'use client';

import { QueryClient, hashKey } from '@tanstack/react-query';
import { callMethod } from './method';
import { startWebsockets, subscribeLiveQuery } from '../websocket/client';

type Args = Record<string, unknown>;

interface Subscription {
  unsubscribe: () => void;
  resolvers: Set<{
    resolve: (data: unknown) => void;
    reject: (error: Error) => void;
  }>;
}

let queryClientRef: QueryClient | null = null;
let cacheUnsubscribe: (() => void) | null = null;
let websocketsStarted = false;
const subscriptions = new Map<string, Subscription>();

/**
 * Connects a `QueryClient` to Modelence's live-query layer. Auto-called by
 * `<ModelenceQueryProvider>`; only call manually if you mount your own
 * `<QueryClientProvider>`.
 *
 * Note: WebSocket setup is deferred until the first `modelenceLiveQuery`
 * call, so apps that only use `modelenceQuery`/`modelenceMutation` never
 * open a socket.
 */
export function connectModelenceQueryClient(queryClient: QueryClient) {
  if (queryClientRef === queryClient) {
    return;
  }

  if (queryClientRef) {
    disconnectModelenceQueryClient();
  }

  queryClientRef = queryClient;

  cacheUnsubscribe = queryClient.getQueryCache().subscribe((event) => {
    if (event.type === 'removed') {
      const subscriptionKey = hashKey(event.query.queryKey);
      const sub = subscriptions.get(subscriptionKey);
      if (sub) {
        if (sub.resolvers.size > 0) {
          const cancelError = new Error('Query was removed from cache');
          sub.resolvers.forEach((r) => r.reject(cancelError));
          sub.resolvers.clear();
        }
        sub.unsubscribe();
        subscriptions.delete(subscriptionKey);
      }
    }
  });
}

export function disconnectModelenceQueryClient() {
  if (cacheUnsubscribe) {
    cacheUnsubscribe();
    cacheUnsubscribe = null;
  }
  subscriptions.forEach((sub) => sub.unsubscribe());
  subscriptions.clear();
  queryClientRef = null;
  websocketsStarted = false;
}

/** @deprecated Use `connectModelenceQueryClient(queryClient)` instead. */
export class ModelenceQueryClient {
  connect(queryClient: QueryClient) {
    connectModelenceQueryClient(queryClient);
  }
}

/**
 * @example
 * ```tsx
 * const { data } = useQuery(modelenceQuery('todo.getAll'));
 * ```
 */
export function modelenceQuery<T = unknown>(methodName: string, args: Args = {}) {
  return {
    queryKey: [methodName, args],
    queryFn: () => callMethod<T>(methodName, args),
  };
}

/**
 * Live query — data updates in real time as the underlying collection changes.
 * Requires a `QueryClient` connected via `<ModelenceQueryProvider>` or
 * `connectModelenceQueryClient(...)`.
 */
export function modelenceLiveQuery<T = unknown>(methodName: string, args: Args = {}) {
  const queryKey = ['live', methodName, args] as const;
  const subscriptionKey = hashKey(queryKey);

  return {
    queryKey,
    queryFn: () =>
      new Promise<T>((resolve, reject) => {
        // Live queries are WebSocket subscriptions — no server snapshot. Stay
        // pending on the server so Suspense renders; client re-runs after hydration.
        if (typeof window === 'undefined') {
          return;
        }

        if (!queryClientRef) {
          const error = new Error(
            'Modelence: connect a QueryClient before using modelenceLiveQuery(). Mount <ModelenceQueryProvider> or call connectModelenceQueryClient().'
          );
          console.error('[Modelence]', error.message);
          reject(error);
          return;
        }

        if (!websocketsStarted) {
          startWebsockets();
          websocketsStarted = true;
        }

        let sub = subscriptions.get(subscriptionKey);

        if (!sub) {
          const unsubscribe = subscribeLiveQuery<T>(
            methodName,
            args,
            (data) => {
              const currentSub = subscriptions.get(subscriptionKey);

              if (currentSub?.resolvers.size) {
                currentSub.resolvers.forEach((r) => r.resolve(data));
                currentSub.resolvers.clear();
              }

              if (queryClientRef) {
                queryClientRef.setQueryData(queryKey, data);
              }
            },
            (error) => {
              const currentSub = subscriptions.get(subscriptionKey);
              if (currentSub) {
                if (currentSub.resolvers.size) {
                  currentSub.resolvers.forEach((r) => r.reject(new Error(error)));
                  currentSub.resolvers.clear();
                }
                currentSub.unsubscribe();
                subscriptions.delete(subscriptionKey);
              }
            }
          );

          sub = { unsubscribe, resolvers: new Set() };
          subscriptions.set(subscriptionKey, sub);
        }

        // Shared map stores resolvers across `T` instantiations; erase the union.
        sub.resolvers.add({
          resolve: resolve as (data: unknown) => void,
          reject,
        });
      }),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
    gcTime: 0,
  };
}

export function modelenceMutation<T = unknown>(methodName: string, defaultArgs: Args = {}) {
  return {
    mutationFn: (variables: Args = {}) =>
      callMethod<T>(methodName, { ...defaultArgs, ...variables }),
  };
}

export type ModelenceQueryKey<T extends string, U extends Args = Args> = readonly [T, U];

/** Builds a query key matching `modelenceQuery(...)` for cache operations. */
export function createQueryKey<T extends string, U extends Args = Args>(
  methodName: T,
  args: U = {} as U
): ModelenceQueryKey<T, U> {
  return [methodName, args] as const;
}
