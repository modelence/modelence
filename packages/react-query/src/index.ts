import { callMethod } from 'modelence/client';

type Args = Record<string, unknown>;

/**
 * Creates a query configuration object that can be passed to TanStack Query's useQuery hook.
 * 
 * This follows the Convex pattern where instead of wrapping useQuery, we provide a factory
 * function that generates the query configuration.
 * 
 * @param methodName - The name of the Modelence query method to call
 * @param args - Arguments to pass to the method
 * @returns Query configuration object for use with TanStack Query's useQuery
 * 
 * @example
 * ```tsx
 * import { useQuery } from '@tanstack/react-query';
 * import { getQueryOptions } from '@modelence/react-query';
 * 
 * function TodoList() {
 *   const { data, isPending, error } = useQuery(
 *     getQueryOptions('todo.getAll', { limit: 10 })
 *   );
 *   
 *   if (isPending) return <div>Loading...</div>;
 *   if (error) return <div>Error: {error.message}</div>;
 *   return <div>{data?.map(todo => <div key={todo.id}>{todo.title}</div>)}</div>;
 * }
 * ```
 */
export function getQueryOptions<T = unknown>(
  methodName: string,
  args: Args = {}
): {
  queryKey: readonly [string, Args];
  queryFn: () => Promise<T>;
} {
  return {
    queryKey: [methodName, args] as const,
    queryFn: () => callMethod<T>(methodName, args),
  };
}

/**
 * Creates a mutation configuration object that can be passed to TanStack Query's useMutation hook.
 * 
 * This follows the Convex pattern where instead of wrapping useMutation, we provide a factory
 * function that generates the mutation configuration.
 * 
 * @param methodName - The name of the Modelence mutation method to call
 * @param defaultArgs - Default arguments to merge with mutation variables (optional)
 * @returns Mutation configuration object for use with TanStack Query's useMutation
 * 
 * @example
 * ```tsx
 * import { useMutation, useQueryClient } from '@tanstack/react-query';
 * import { getMutationOptions } from '@modelence/react-query';
 * 
 * function CreateTodo() {
 *   const queryClient = useQueryClient();
 *   
 *   const { mutate: createTodo, isPending } = useMutation({
 *     ...getMutationOptions('todo.create'),
 *     onSuccess: () => {
 *       queryClient.invalidateQueries({ queryKey: ['todo.getAll'] });
 *     },
 *   });
 *   
 *   return (
 *     <button 
 *       onClick={() => createTodo({ title: 'New Todo' })}
 *       disabled={isPending}
 *     >
 *       {isPending ? 'Creating...' : 'Create Todo'}
 *     </button>
 *   );
 * }
 * ```
 */
export function getMutationOptions<T = unknown, TVariables = Args>(
  methodName: string,
  defaultArgs: Args = {}
): {
  mutationFn: (variables: TVariables) => Promise<T>;
} {
  return {
    mutationFn: (variables: TVariables) => {
      const mergedArgs = { ...defaultArgs, ...variables };
      return callMethod<T>(methodName, mergedArgs);
    },
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
