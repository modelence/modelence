import { QueryClient, hashKey } from '@tanstack/react-query';
import { callMethod, subscribeLiveQuery, startWebsockets } from 'modelence/client';

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
 * Client for managing Modelence live queries with TanStack Query.
 * Create one instance and connect it to your QueryClient.
 * 
 * @example
 * ```tsx
 * import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
 * import { ModelenceQueryClient } from '@modelence/react-query';
 * 
 * const queryClient = new QueryClient();
 * new ModelenceQueryClient().connect(queryClient);
 * 
 * function App() {
 *   return (
 *     <QueryClientProvider client={queryClient}>
 *       <YourApp />
 *     </QueryClientProvider>
 *   );
 * }
 * ```
 */
export class ModelenceQueryClient {
  /**
   * Connects to a TanStack Query QueryClient.
   * This enables live query subscriptions and cache updates.
   */
  connect(queryClient: QueryClient) {
    // Only support one query client at a time
    if (queryClientRef) {
      throw new Error('ModelenceQueryClient can only be connected to one QueryClient');
    }

    if (cacheUnsubscribe) {
      cacheUnsubscribe();
      subscriptions.forEach((sub) => sub.unsubscribe());
      subscriptions.clear();
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
}

/**
 * Creates query options for use with TanStack Query's useQuery hook.
 * 
 * @example
 * ```tsx
 * import { useQuery } from '@tanstack/react-query';
 * import { modelenceQuery } from '@modelence/react-query';
 * 
 * function MyComponent() {
 *   // Basic usage
 *   const { data } = useQuery(modelenceQuery('todo.getAll'));
 * 
 *   // With additional options
 *   const { data: todo } = useQuery({
 *     ...modelenceQuery('todo.getById', { id: '123' }),
 *     enabled: !!id,
 *     staleTime: 5 * 60 * 1000,
 *   });
 * 
 *   return <div>{data?.name}</div>;
 * }
 * ```
 * 
 * @typeParam T - The expected return type of the query
 * @param methodName - The name of the method to query
 * @param args - Optional arguments to pass to the method
 * @returns Query options object for TanStack Query's useQuery
 * 
 */
export function modelenceQuery<T = unknown>(
  methodName: string, 
  args: Args = {}
) {
  return {
    queryKey: [methodName, args],
    queryFn: () => callMethod<T>(methodName, args),
  };
}

export interface LiveQueryOptions {
  /**
   * If false, the socket subscription will not be made.
   * Use this to prevent subscriptions until certain conditions are met (e.g., user is authenticated).
   * 
   * IMPORTANT: You must also pass `enabled` to useQuery for proper React Query integration.
   * 
   * @default true
   */
  enabled?: boolean;
}

/**
 * Creates query options for live queries with TanStack Query's useQuery hook.
 * Data will be updated in real-time when underlying data changes.
 * 
 * Requires ModelenceQueryClient to be connected to your QueryClient.
 * 
 * @example
 * ```tsx
 * import { useQuery } from '@tanstack/react-query';
 * import { modelenceLiveQuery } from '@modelence/react-query';
 * 
 * function TodoList() {
 *   // Subscribe to live updates - data refreshes automatically when todos change
 *   const { data: todos } = useQuery(modelenceLiveQuery('todo.getAll', { userId }));
 * 
 *   return (
 *     <ul>
 *       {todos?.map(todo => <li key={todo._id}>{todo.title}</li>)}
 *     </ul>
 *   );
 * }
 * ```
 * 
 * @example
 * ```tsx
 * // With conditional subscription (e.g., wait for authentication)
 * function AuthenticatedData() {
 *   const { user } = useSession();
 *   const enabled = !!user;
 *   
 *   const { data } = useQuery({
 *     ...modelenceLiveQuery('notifications.getPending', {}, { enabled }),
 *     enabled, // Also pass to useQuery
 *   });
 * }
 * ```
 * 
 * @typeParam T - The expected return type of the query
 * @param methodName - The name of the method to query
 * @param args - Optional arguments to pass to the method
 * @param options - Optional configuration including `enabled` to control subscription
 * @returns Query options object for TanStack Query's useQuery
 */
export function modelenceLiveQuery<T = unknown>(
  methodName: string, 
  args: Args = {},
  options: LiveQueryOptions = {}
) {
  const { enabled = true } = options;
  const queryKey = ['live', methodName, args] as const;
  const subscriptionKey = hashKey(queryKey);

  return {
    queryKey,
    queryFn: () => new Promise<T>((resolve, reject) => {
      if (!queryClientRef) {
        const error = new Error('ModelenceQueryClient must be connected before using modelenceLiveQuery()');
        console.error('[Modelence]', error.message);
        reject(error);
        return;
      }

      // Don't subscribe if explicitly disabled
      // This prevents socket subscriptions when conditions aren't met (e.g., not authenticated)
      if (!enabled) {
        // Return without resolving - the query will stay in pending state
        // React Query should not call queryFn when enabled:false, but this is a safety check
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
 * Creates mutation options for use with TanStack Query's useMutation hook.
 * 
 * @typeParam T - The expected return type of the mutation
 * @param methodName - The name of the method to mutate
 * @param defaultArgs - Optional default arguments to merge with mutation variables
 * @returns Mutation options object for TanStack Query's useMutation
 * 
 * @example
 * ```tsx
 * import { useMutation, useQueryClient } from '@tanstack/react-query';
 * import { modelenceMutation } from '@modelence/react-query';
 * 
 * function MyComponent() {
 *   const queryClient = useQueryClient();
 *   
 *   // Basic usage
 *   const { mutate } = useMutation(modelenceMutation('todos.create'));
 * 
 *   // With additional options
 *   const { mutate: updateTodo } = useMutation({
 *     ...modelenceMutation('todos.update'),
 *     onSuccess: () => {
 *       queryClient.invalidateQueries({ queryKey: ['todos.getAll'] });
 *     },
 *   });
 * 
 *   return <button onClick={() => mutate({ title: 'New Todo' })}>Create</button>;
 * }
 * ```
 */
export function modelenceMutation<T = unknown>(
  methodName: string, 
  defaultArgs: Args = {}
) {
  return {
    mutationFn: (variables: Args = {}) => callMethod<T>(methodName, { ...defaultArgs, ...variables }),
  };
}

/**
 * Type helper for creating properly typed query keys
 */
export type ModelenceQueryKey<T extends string, U extends Args = Args> = readonly [T, U];

/**
 * Utility function to create query keys for manual cache operations
 * 
 * @param methodName - The method name
 * @param args - The arguments
 * @returns Typed query key
 * 
 * @example
 * ```tsx
 * import { useQueryClient } from '@tanstack/react-query';
 * import { createQueryKey } from '@modelence/react-query';
 * 
 * function TodoActions() {
 *   const queryClient = useQueryClient();
 *   
 *   const refreshTodos = () => {
 *     queryClient.invalidateQueries({ 
 *       queryKey: createQueryKey('todo.getAll', { limit: 10 }) 
 *     });
 *   };
 * }
 * ```
 */
export function createQueryKey<T extends string, U extends Args = Args>(
  methodName: T,
  args: U = {} as U
): ModelenceQueryKey<T, U> {
  return [methodName, args] as const;
}
