/**
 * @group React Hooks
 * Client-side React hooks for data fetching and mutations
 */

/*
  The "use client" directive is specifically for the Next.js layout component, which is rendered on the server by default.
  Because of this, we are explicitly marking it as a client component, so we can render this component on the client
  and properly initialize config on the client side.
  
  While this is specific to Next.js, it is simply ignored outside of Next.js and should not cause errors.
*/
"use client";

import { useQuery as useTanQuery, useMutation as useTanMutation } from '@tanstack/react-query';
import { getLocalStorageSession } from './localStorage';
import { handleError } from './errorHandler';
import { reviveResponseTypes } from '../methods/serialize';

type Args = Record<string, unknown>;

type MethodResult<T> = {
  isFetching: boolean;
  error: Error | null;
  data: T | null;
};

type PlaceholderData<T> = T | ((prev: T | null) => T);

type QueryOptions<T> = {
  enabled?: boolean;
  placeholderData?: PlaceholderData<T>;
};

export async function callMethod<T = unknown>(methodName: string, args: Args = {}): Promise<T> {
  try {
    return await call<T>(`/api/_internal/method/${methodName}`, args);
  } catch (error) {
    handleError(error as Error, methodName);
    throw error;
  }
}

async function call<T = unknown>(endpoint: string, args: Args): Promise<T> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      args,
      authToken: getLocalStorageSession()?.authToken,
      clientInfo: {
        screenWidth: window.screen.width,
        screenHeight: window.screen.height,
        windowWidth: window.innerWidth,
        windowHeight: window.innerHeight,
        pixelRatio: window.devicePixelRatio,
        orientation: window.screen.orientation?.type
      }
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(error);
  }

  const text = await response.text();
  const result = text ? JSON.parse(text) : undefined;
  if (!result) {
    throw new Error('Invalid response from server');
  }

  return reviveResponseTypes(result.data, result.typeMap);
}

/**
 * React hook for executing a query method.
 * 
 * This hook automatically executes the query on mount and provides a refetch capability.
 * Similar to React Query's useQuery hook.
 * 
 * @typeParam T - The expected return type of the query
 * @param methodName - The name of the method to query
 * @param args - Optional arguments to pass to the method
 * @param options - Optional options object
 * @param options.enabled - Boolean indicating if the query should be enabled
 * @returns {Object} An object containing the query state and a refetch function:
 * - `data` - The data returned by the query, or null if not yet loaded
 * - `isFetching` - Boolean indicating if the query is in progress
 * - `error` - Any error that occurred during the query, or null
 * - `refetch` - Function to manually trigger a refetch with optional new arguments
 * 
 * @example
 * ```tsx
 * function MyComponent() {
 *   // This is assuming you have a Module named "todo" with a query named "getItem"
 *   const { data, isFetching, error } = useQuery<Todo>('todo.getItem', { id: '123' });
 *   if (isFetching) {
 *     return <div>Loading...</div>;
 *   }
 *   if (error) {
 *     return <div>Error: {error.message}</div>;
 *   }
 *   return <div>{data?.name}</div>;
 * }
 * ```
 */
export function useQuery<T = unknown>(
  methodName: string, 
  args: Args = {}, 
  options?: QueryOptions<T>
): MethodResult<T> & {
  /** Function to manually trigger a refetch of the query with optional new arguments */
  refetch: (args?: Args) => void
} {
  type QueryKey = [string, Args];
  
  const query = useTanQuery<T, Error, T, QueryKey>({
    queryKey: [methodName, args],
    queryFn: () => callMethod<T>(methodName, args),
    enabled: options?.enabled ?? true,
    placeholderData: options?.placeholderData as any
  });

  return {
    data: query.data ?? null,
    error: query.error as Error | null,
    isFetching: query.isFetching,
    refetch: () => query.refetch(),
  };
}

/**
 * React hook for executing a mutation method.
 * 
 * This hook provides functions to trigger the mutation manually and handles loading/error states.
 * Similar to React Query's useMutation hook.
 * 
 * @typeParam T - The expected return type of the mutation
 * @param methodName - The name of the method to mutate
 * @param args - Optional default arguments to pass to the method
 * @returns {Object} An object containing the mutation state and trigger functions:
 * - `data` - The data returned by the last successful mutation, or null
 * - `isFetching` - Boolean indicating if the mutation is in progress
 * - `error` - Any error that occurred during the last mutation, or null
 * - `mutate` - Function to trigger the mutation with optional arguments
 * - `mutateAsync` - Promise-returning version of mutate, useful for awaiting the result
 * 
 * @example
 * ```tsx
 * const { mutate: updateTodo, isFetching, error } = useMutation<User>('todos.update');
 * 
 * // Later in your code:
 * updateTodo({ id: '123', name: 'New Name' });
 * ```
 */
export function useMutation<T = unknown>(methodName: string, args: Args = {}) {
  const mutation = useTanMutation({
    mutationFn: (newArgs: Args = {}) => callMethod<T>(methodName, { ...args, ...newArgs }),
  });

  return {
    data: mutation.data ?? null,
    error: mutation.error as Error | null,
    isFetching: mutation.isPending, // Legacy
    isPending: mutation.isPending,
    mutate: mutation.mutate,
    mutateAsync: mutation.mutateAsync,
  };
}
