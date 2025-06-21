import { callMethod } from 'modelence/client';

type Args = Record<string, unknown>;

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
