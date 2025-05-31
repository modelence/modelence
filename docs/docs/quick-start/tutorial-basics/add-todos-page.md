---
sidebar_position: 3
---

# Add Todos page

Modelence is mostly frontend-agnostic, so you are free to use any routing library you like.
We will use React Router for this example, which is what's included in the default Modelence starter.

## Create a new client route

Edit `src/client/routes.ts` to add a new route for our todos:

```tsx title="src/client/routes.ts"
import { lazy } from 'react';

export const routes = [
  ...
  // Add this after the other routes
  {
    path: '/todos',
    Component: lazy(() => import('./TodosPage'))
  },
  ...
];
```

## Create the TodosPage component

Create a new component at `src/client/TodosPage.tsx`:

```tsx title="src/client/TodosPage.tsx"
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { modelenceQuery, modelenceMutation } from 'modelence/client';

export default function TodosPage() {
  const queryClient = useQueryClient();
  
  /*
    Modelence provides `modelenceQuery` and `modelenceMutation` functions that return
    options for TanStack Query's useQuery and useMutation hooks.
    This gives you full access to TanStack Query's features while integrating with Modelence.
  */
  
  // Basic query
  const { data: todos, isLoading, error } = useQuery(
    modelenceQuery('todo.getAll')
  );
  
  // Query with additional TanStack Query options
  const { data: featuredTodo } = useQuery({
    ...modelenceQuery('todo.getFeatured'),
    staleTime: 5 * 60 * 1000, // 5 minutes
    enabled: todos && todos.length > 0, // Only run if we have todos
  });
  
  // Basic mutation
  const { mutate: createTodo, isPending } = useMutation({
    ...modelenceMutation('todo.create'),
    onSuccess: () => {
      // Invalidate and refetch todos after creating a new one
      queryClient.invalidateQueries({ queryKey: ['todo.getAll'] });
    },
  });

  const handleCreateTodo = () => {
    createTodo({ title: 'New Todo', completed: false });
  };

  if (isLoading) {
    return <div>Loading...</div>;
  }

  if (error) {
    return <div>Error: {error.message}</div>;
  }

  return (
    <div>
      <h1>Todos</h1>
      <button onClick={handleCreateTodo} disabled={isPending}>
        {isPending ? 'Creating...' : 'Create Todo'}
      </button>
      {featuredTodo && (
        <div>
          <h2>Featured Todo</h2>
          <p>{featuredTodo.title}</p>
        </div>
      )}
      <ul>
        {todos?.map((todo) => (
          <li key={todo.id}>{todo.title}</li>
        ))}
      </ul>
    </div>
  );
}
```

Now, you should be able to see your page at http://localhost:3000/todos
