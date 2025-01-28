/*
  The "use client" directive is specifically for the Next.js layout component, which is rendered on the server by default.
  Because of this, we are explicitly marking it as a client component, so we can render this component on the client
  and properly initialize config on the client side.
  
  While this is specific to Next.js, it is simply ignored outside of Next.js and should not cause errors.
*/
"use client";

import { useState, useEffect, useMemo } from 'react';
import { getLocalStorageSession } from './localStorage';
import { handleError } from './errorHandler';
import { reviveResponseTypes } from '../methods/serialize';

type Args = Record<string, unknown>;

type MethodResult<T> = {
  isFetching: boolean;
  error: Error | null;
  data: T | null;
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
export function useQuery<T = unknown>(methodName: string, args: Args = {}): MethodResult<T> & {
  /** Function to manually trigger a refetch of the query with optional new arguments */
  refetch: (args?: Args) => void
} {
  const { result, triggerMethod } = useMethod<T>(methodName, args, { enabled: true });
  return {
    ...result,
    refetch: (args?: Args) => triggerMethod(args),
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
export function useMutation<T = unknown>(methodName: string, args: Args = {}): MethodResult<T> & {
  /** Function to trigger the mutation with optional arguments */
  mutate: (args?: Args) => void,
  /** 
   * Async version of mutate that returns a promise with the result.
   * Useful when you need to wait for the mutation to complete.
   */
  mutateAsync: (args?: Args) => Promise<T>
} {
  const { result, triggerMethod } = useMethod<T>(methodName, args, { enabled: false });
  return {
    ...result,
    mutate: (args?: Args) => triggerMethod(args),
    mutateAsync: triggerMethod,
  };
}

export function useMethod<T>(methodName: string, args: Args = {}, options: { enabled: boolean }): {
  result: MethodResult<T>,
  triggerMethod: (args?: Args) => Promise<T>
} {
  // Memoize the args object to maintain reference stability and prevent infinite re-renders
  const stableArgs = useMemo(() => args, [JSON.stringify(args)]);

  const [result, setResult] = useState<MethodResult<T>>({
    isFetching: options.enabled,
    error: null,
    data: null,
  });

  const triggerMethod = async (args: Args = stableArgs) => {
    setResult({ isFetching: true, error: null, data: result.data });
    try {
      const data = await callMethod<T>(methodName, args);
      setResult({ isFetching: false, error: null, data });
      return data;
    } catch (error) {
      setResult({ isFetching: false, error: error as Error, data: null });
      throw error;
    }
  };

  // TODO: switch to React Query (TanStack Query)
  useEffect(() => {
    if (!options.enabled) {
      return;
    }

    triggerMethod();
  }, [methodName, stableArgs]);

  return { result, triggerMethod };
}
