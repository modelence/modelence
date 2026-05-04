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
const subscriptions = new Map<string, Subscription>();

/**
 * Connect a TanStack Query `QueryClient` to Modelence's live-query layer.
 *
 * Wires the query cache to the websocket subscription manager so that
 * `modelenceLiveQuery(...)` can deliver real-time updates and so that cache
 * eviction tears down the underlying subscription.
 *
 * Idempotent for a given `QueryClient`. If a different `QueryClient` is
 * already connected (e.g. StrictMode's double-invoked `useState` initializer
 * created two clients before mount, or the user remounted the provider), the
 * old binding is torn down and the new client takes over.
 *
 * The framework calls this automatically from `<ModelenceQueryProvider>`,
 * so most apps never need to call it directly. Use the manual API only if
 * you are mounting your own `<QueryClientProvider>`.
 */
export function connectModelenceQueryClient(queryClient: QueryClient) {
  if (queryClientRef === queryClient) {
    return;
  }

  if (queryClientRef) {
    disconnectModelenceQueryClient();
  }

  startWebsockets();

  queryClientRef = queryClient;

  cacheUnsubscribe = queryClient.getQueryCache().subscribe((event) => {
    if (event.type === 'removed') {
      const subscriptionKey = hashKey(event.query.queryKey);
      const sub = subscriptions.get(subscriptionKey);
      if (sub) {
        // Reject any pending resolvers since the query was removed
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

/**
 * Disconnect the currently-connected `QueryClient` and tear down all live
 * subscriptions. Useful in tests and when remounting a fresh provider.
 */
export function disconnectModelenceQueryClient() {
  if (cacheUnsubscribe) {
    cacheUnsubscribe();
    cacheUnsubscribe = null;
  }
  subscriptions.forEach((sub) => sub.unsubscribe());
  subscriptions.clear();
  queryClientRef = null;
}

/**
 * Class-form connector kept for backwards compatibility with
 * `@modelence/react-query`. Prefer `connectModelenceQueryClient()` directly.
 *
 * @deprecated Use `connectModelenceQueryClient(queryClient)` instead.
 */
export class ModelenceQueryClient {
  connect(queryClient: QueryClient) {
    connectModelenceQueryClient(queryClient);
  }
}

/**
 * Creates query options for use with TanStack Query's `useQuery` hook.
 *
 * @example
 * ```tsx
 * import { useQuery } from '@tanstack/react-query';
 * import { modelenceQuery } from 'modelence/client';
 *
 * function MyComponent() {
 *   const { data } = useQuery(modelenceQuery('todo.getAll'));
 *   return <div>{data?.length}</div>;
 * }
 * ```
 *
 * @typeParam T - The expected return type of the query.
 * @param methodName - The Modelence method name to invoke.
 * @param args - Optional arguments passed to the method handler.
 */
export function modelenceQuery<T = unknown>(methodName: string, args: Args = {}) {
  return {
    queryKey: [methodName, args],
    queryFn: () => callMethod<T>(methodName, args),
  };
}

/**
 * Creates query options for live queries with TanStack Query's `useQuery`
 * hook. Data updates in real time when the underlying collection changes.
 *
 * Requires a `QueryClient` to be connected — `<ModelenceQueryProvider>` does
 * this automatically. If you mount your own provider, call
 * `connectModelenceQueryClient(queryClient)` once.
 *
 * @typeParam T - The expected return type of the query.
 * @param methodName - The Modelence live-query method name.
 * @param args - Optional arguments passed to the method handler.
 */
export function modelenceLiveQuery<T = unknown>(methodName: string, args: Args = {}) {
  const queryKey = ['live', methodName, args] as const;
  const subscriptionKey = hashKey(queryKey);

  return {
    queryKey,
    queryFn: () =>
      new Promise<T>((resolve, reject) => {
        if (!queryClientRef) {
          const error = new Error(
            'Modelence: connect a QueryClient before using modelenceLiveQuery(). Mount <ModelenceQueryProvider> or call connectModelenceQueryClient().'
          );
          console.error('[Modelence]', error.message);
          reject(error);
          return;
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

/**
 * Creates mutation options for use with TanStack Query's `useMutation` hook.
 *
 * @typeParam T - The expected return type of the mutation.
 * @param methodName - The Modelence mutation method name.
 * @param defaultArgs - Optional default args merged with the variables passed
 *  to `mutate(...)`.
 */
export function modelenceMutation<T = unknown>(methodName: string, defaultArgs: Args = {}) {
  return {
    mutationFn: (variables: Args = {}) =>
      callMethod<T>(methodName, { ...defaultArgs, ...variables }),
  };
}

/**
 * Strongly-typed query key for use with manual cache operations
 * (`queryClient.invalidateQueries`, `getQueryData`, etc.).
 */
export type ModelenceQueryKey<T extends string, U extends Args = Args> = readonly [T, U];

/**
 * Build a typed query key matching what `modelenceQuery(...)` produces.
 *
 * @example
 * ```tsx
 * queryClient.invalidateQueries({
 *   queryKey: createQueryKey('todo.getAll', { limit: 10 }),
 * });
 * ```
 */
export function createQueryKey<T extends string, U extends Args = Args>(
  methodName: T,
  args: U = {} as U
): ModelenceQueryKey<T, U> {
  return [methodName, args] as const;
}
