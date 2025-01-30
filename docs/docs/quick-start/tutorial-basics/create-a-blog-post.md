---
sidebar_position: 3
---

# Create client routes

Modelence is not opinionated about frontend, so you are free to use any routing library you like.
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
import { useQuery } from 'modelence/client';

export default function TodosPage() {
  /*
    Modelence provides a `useQuery` React hook that fetches data from a module query.
    It will automatically re-fetch the data if/when the query changes and can also accept arguments.
  */
  const { data: todos, isFetching, error } = useQuery('todo.getAll');

  if (isFetching) {
    return <div>Loading...</div>;
  }

  if (error) {
    return <div>Error: {error.message}</div>;
  }

  return (
    <div>
      <h1>Todos</h1>
      <ul>
        {todos.map((todo) => (
          <li key={todo.id}>{todo.title}</li>
        ))}
      </ul>
    </div>
  );
}
```

Now, once you add data to your `todos` MongoDB collection, you should be able to see it at http://localhost:3000/todos
