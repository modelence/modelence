# @modelence/react-query

React Query utilities for Modelence method calls.

## Installation

```bash
npm i @modelence/react-query @tanstack/react-query
```

## Overview

This package provides `getQueryOptions` and `getMutationOptions` factory functions that can be used with TanStack Query's native `useQuery` and `useMutation` hooks. This approach, recommended by TanStack, gives you direct access to TanStack Query's full API while providing Modelence-specific query configurations.

## Usage

### Basic Query

```tsx
import { useQuery } from '@tanstack/react-query';
import { getQueryOptions } from '@modelence/react-query';

function TodoList() {
  const { data, isPending, error } = useQuery(
    getQueryOptions('todo.getAll', { limit: 10 })
  );
  
  if (isPending) return <div>Loading...</div>;
  if (error) return <div>Error: {error.message}</div>;
  
  return (
    <div>
      {data?.map(todo => (
        <div key={todo.id}>{todo.title}</div>
      ))}
    </div>
  );
}
```

### Basic Mutation

```tsx
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getMutationOptions } from '@modelence/react-query';

function CreateTodo() {
  const queryClient = useQueryClient();
  
  const { mutate: createTodo, isPending } = useMutation({
    ...getMutationOptions('todo.create'),
    onSuccess: () => {
      // Invalidate and refetch todos
      queryClient.invalidateQueries({ queryKey: ['todo.getAll'] });
    },
  });
  
  return (
    <button 
      onClick={() => createTodo({ title: 'New Todo', completed: false })}
      disabled={isPending}
    >
      {isPending ? 'Creating...' : 'Create Todo'}
    </button>
  );
}
```

### Advanced Usage

#### Query with Additional Options

```tsx
import { useQuery } from '@tanstack/react-query';
import { getQueryOptions } from '@modelence/react-query';

function TodoDetail({ id }: { id: string }) {
  const { data: todo } = useQuery({
    ...getQueryOptions('todo.getById', { id }),
    enabled: !!id, // Only run query if id exists
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchOnWindowFocus: false,
  });
  
  return <div>{todo?.title}</div>;
}
```

#### Mutation with Default Args

```tsx
import { useMutation } from '@tanstack/react-query';
import { getMutationOptions } from '@modelence/react-query';

function UpdateTodo({ todoId }: { todoId: string }) {
  const { mutate: updateTodo } = useMutation({
    ...getMutationOptions('todo.update', { id: todoId }), // Default args
    onSuccess: (data) => {
      console.log('Todo updated:', data);
    },
  });
  
  return (
    <button onClick={() => updateTodo({ title: 'Updated Title' })}>
      Update Todo
    </button>
  );
}
```

#### Manual Cache Operations

```tsx
import { useQueryClient } from '@tanstack/react-query';
import { createQueryKey, getQueryOptions } from '@modelence/react-query';

function TodoActions() {
  const queryClient = useQueryClient();
  
  const refreshTodos = () => {
    queryClient.invalidateQueries({ 
      queryKey: createQueryKey('todo.getAll', { limit: 10 }) 
    });
  };
  
  const prefetchTodo = (id: string) => {
    queryClient.prefetchQuery({
      ...getQueryOptions('todo.getById', { id }),
      staleTime: 10 * 60 * 1000, // 10 minutes
    });
  };
  
  return (
    <div>
      <button onClick={refreshTodos}>Refresh Todos</button>
      <button onClick={() => prefetchTodo('123')}>Prefetch Todo</button>
    </div>
  );
}
```

## API Reference

### `getQueryOptions<T>(methodName, args?)`

Creates a query configuration object for use with TanStack Query's `useQuery`.

**Parameters:**
- `methodName` (string): The Modelence method name (e.g., 'todo.getAll')
- `args` (object, optional): Arguments to pass to the method

**Returns:** Query configuration object with `queryKey` and `queryFn`

### `getMutationOptions<T, TVariables>(methodName, defaultArgs?)`

Creates a mutation configuration object for use with TanStack Query's `useMutation`.

**Parameters:**
- `methodName` (string): The Modelence method name (e.g., 'todo.create')
- `defaultArgs` (object, optional): Default arguments merged with mutation variables

**Returns:** Mutation configuration object with `mutationFn`

### `createQueryKey<T, U>(methodName, args?)`

Utility function to create typed query keys for manual cache operations.

**Parameters:**
- `methodName` (T): The method name
- `args` (U, optional): The arguments

**Returns:** Typed query key array

## Migration from Modelence's useQuery/useMutation

### Before

```tsx
import { useQuery, useMutation } from 'modelence/client';

function TodoComponent() {
  const { data, isFetching, error } = useQuery('todo.getAll');
  const { mutate: createTodo } = useMutation('todo.create');
  
  // ...
}
```

### After

```tsx
import { useQuery, useMutation } from '@tanstack/react-query';
import { getQueryOptions, getMutationOptions } from '@modelence/react-query';

function TodoComponent() {
  const { data, isPending: isFetching, error } = useQuery(
    getQueryOptions('todo.getAll')
  );
  const { mutate: createTodo } = useMutation(
    getMutationOptions('todo.create')
  );
  
  // ...
}
```

## Benefits

1. **Full TanStack Query API**: Access to all TanStack Query features and options
2. **Simple and Explicit**: Clear separation between Modelence configuration and TanStack Query options
3. **Better TypeScript Support**: Improved type inference and safety
4. **Familiar API**: Standard TanStack Query patterns that developers already know
5. **Future-Proof**: Easy to adopt new TanStack Query features as they're released
6. **Composability**: Easy to combine with other TanStack Query utilities
