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

import { getLocalStorageSession } from './localStorage';
import { handleError } from './errorHandler';
import { reviveResponseTypes } from '../methods/serialize';

type Args = Record<string, unknown>;

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
 * Creates query options for use with TanStack Query's useQuery hook.
 * 
 * @typeParam T - The expected return type of the query
 * @param methodName - The name of the method to query
 * @param args - Optional arguments to pass to the method
 * @returns Query options object for TanStack Query's useQuery
 * 
 * @example
 * ```tsx
 * import { useQuery } from '@tanstack/react-query';
 * import { modelenceQuery } from 'modelence/client';
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
 * import { modelenceMutation } from 'modelence/client';
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
