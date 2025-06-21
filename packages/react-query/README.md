# @modelence/react-query

React Query utilities for Modelence method calls.

## Installation

```bash
npm i @modelence/react-query @tanstack/react-query
```

## Overview

This package provides `modelenceQuery` and `modelenceMutation` factory functions that can be used with TanStack Query's native `useQuery` and `useMutation` hooks. This approach, recommended by TanStack, gives you direct access to TanStack Query's full API while providing Modelence-specific query configurations.

## Usage

### Basic Query

```tsx
import { useQuery } from '@tanstack/react-query';
import { modelenceQuery } from '@modelence/react-query';

function TodoList() {
  const { data, isPending, error } = useQuery(
    modelenceQuery('todo.getAll', { limit: 10 })
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
import { modelenceMutation } from '@modelence/react-query';

function CreateTodo() {
  const queryClient = useQueryClient();
  
  const { mutate: createTodo, isPending } = useMutation({
    ...modelenceMutation('todo.create'),
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
import { modelenceQuery } from '@modelence/react-query';

function TodoDetail({ id }: { id: string }) {
  const { data: todo } = useQuery({
    ...modelenceQuery('todo.getById', { id }),
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
import { modelenceMutation } from '@modelence/react-query';

function UpdateTodo({ todoId }: { todoId: string }) {
  const { mutate: updateTodo } = useMutation({
    ...modelenceMutation('todo.update', { id: todoId }), // Default args
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
import { createQueryKey, modelenceQuery } from '@modelence/react-query';

function TodoActions() {
  const queryClient = useQueryClient();
  
  const refreshTodos = () => {
    queryClient.invalidateQueries({ 
      queryKey: createQueryKey('todo.getAll', { limit: 10 }) 
    });
  };
  
  const prefetchTodo = (id: string) => {
    queryClient.prefetchQuery({
      ...modelenceQuery('todo.getById', { id }),
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
