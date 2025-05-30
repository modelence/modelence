import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getQueryOptions, getMutationOptions, createQueryKey } from '@modelence/react-query';

interface Todo {
  id: string;
  title: string;
  completed: boolean;
}

// Example 1: Basic query usage
function TodoList() {
  const { data: todos, isPending, error } = useQuery<Todo[]>(
    getQueryOptions('todo.getAll', { limit: 10 })
  );

  if (isPending) return <div>Loading todos...</div>;
  if (error) return <div>Error: {error.message}</div>;

  return (
    <div>
      <h2>Todos</h2>
      {todos?.map((todo) => (
        <div key={todo.id}>
          <h3>{todo.title}</h3>
          <p>{todo.completed ? '✅' : '⏳'}</p>
        </div>
      ))}
    </div>
  );
}

// Example 2: Query with options and enabled condition
function TodoDetail({ todoId }: { todoId: string | null }) {
  const { data: todo, isPending } = useQuery<Todo>({
    ...getQueryOptions('todo.getById', { id: todoId }),
    enabled: !!todoId, // Only run when todoId exists
    staleTime: 5 * 60 * 1000, // 5 minutes
    retry: 3,
  });

  if (!todoId) return <div>Select a todo</div>;
  if (isPending) return <div>Loading todo...</div>;

  return (
    <div>
      <h3>{todo?.title}</h3>
      <p>Status: {todo?.completed ? 'Completed' : 'Pending'}</p>
    </div>
  );
}

// Example 3: Basic mutation
function CreateTodo() {
  const queryClient = useQueryClient();

  const { mutate: createTodo, isPending, error } = useMutation<Todo, Error, { title: string; completed: boolean }>({
    ...getMutationOptions('todo.create'),
    onSuccess: () => {
      // Invalidate and refetch all todo queries
      queryClient.invalidateQueries({ queryKey: ['todo.getAll'] });
    },
    onError: (error) => {
      console.error('Failed to create todo:', error);
    },
  });

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const title = formData.get('title') as string;
    
    createTodo({ title, completed: false });
    e.currentTarget.reset();
  };

  return (
    <form onSubmit={handleSubmit}>
      <input 
        name="title" 
        placeholder="Enter todo title" 
        required 
        disabled={isPending}
      />
      <button type="submit" disabled={isPending}>
        {isPending ? 'Creating...' : 'Create Todo'}
      </button>
      {error && <p style={{ color: 'red' }}>Error: {error.message}</p>}
    </form>
  );
}

// Example 4: Mutation with default args
function UpdateTodo({ todoId }: { todoId: string }) {
  const queryClient = useQueryClient();

  const { mutate: updateTodo, isPending } = useMutation<Todo, Error, { completed: boolean }>({
    ...getMutationOptions('todo.update', { id: todoId }), // Default id
    onSuccess: () => {
      // Invalidate specific todo and list
      queryClient.invalidateQueries({ queryKey: ['todo.getById'] });
      queryClient.invalidateQueries({ queryKey: ['todo.getAll'] });
    },
  });

  const toggleComplete = () => {
    // The id is already provided in defaultArgs, so we only need the fields to update
    updateTodo({ completed: true });
  };

  return (
    <button onClick={toggleComplete} disabled={isPending}>
      {isPending ? 'Updating...' : 'Mark Complete'}
    </button>
  );
}

// Example 5: Manual cache operations
function TodoActions() {
  const queryClient = useQueryClient();

  const refreshTodos = () => {
    queryClient.invalidateQueries({ 
      queryKey: createQueryKey('todo.getAll', { limit: 10 }) 
    });
  };

  const prefetchTodo = (id: string) => {
    queryClient.prefetchQuery<Todo>({
      ...getQueryOptions('todo.getById', { id }),
      staleTime: 10 * 60 * 1000, // 10 minutes
    });
  };

  const setTodoData = (id: string, todo: Todo) => {
    queryClient.setQueryData(
      createQueryKey('todo.getById', { id }),
      todo
    );
  };

  return (
    <div>
      <button onClick={refreshTodos}>Refresh Todos</button>
      <button onClick={() => prefetchTodo('123')}>Prefetch Todo 123</button>
      <button onClick={() => setTodoData('123', { id: '123', title: 'Test', completed: false })}>
        Set Todo Data
      </button>
    </div>
  );
}

// Example 6: Advanced usage with optimistic updates
function OptimisticTodo({ todoId }: { todoId: string }) {
  const queryClient = useQueryClient();

  const { mutate: updateTodo } = useMutation<
    Todo, 
    Error, 
    { id: string; completed: boolean },
    { previousTodo: Todo | undefined }
  >({
    ...getMutationOptions('todo.update'),
    onMutate: async (variables) => {
      // Cancel outgoing refetches (so they don't overwrite our optimistic update)
      await queryClient.cancelQueries({ 
        queryKey: createQueryKey('todo.getById', { id: todoId })
      });

      // Snapshot the previous value
      const previousTodo = queryClient.getQueryData<Todo>(
        createQueryKey('todo.getById', { id: todoId })
      );

      // Optimistically update to the new value
      queryClient.setQueryData(
        createQueryKey('todo.getById', { id: todoId }),
        (old: Todo | undefined) => old ? { ...old, ...variables } : undefined
      );

      // Return a context object with the snapshotted value
      return { previousTodo };
    },
    onError: (_err, _variables, context) => {
      // If the mutation fails, use the context to roll back
      if (context?.previousTodo) {
        queryClient.setQueryData(
          createQueryKey('todo.getById', { id: todoId }),
          context.previousTodo
        );
      }
    },
    onSettled: () => {
      // Always refetch after error or success
      queryClient.invalidateQueries({ 
        queryKey: createQueryKey('todo.getById', { id: todoId })
      });
    },
  });

  return (
    <button onClick={() => updateTodo({ id: todoId, completed: true })}>
      Update with Optimistic UI
    </button>
  );
}

// Main app component showcasing all examples
export default function App() {
  const [selectedTodoId, setSelectedTodoId] = React.useState<string | null>(null);

  return (
    <div style={{ padding: '20px', maxWidth: '800px', margin: '0 auto' }}>
      <h1>@modelence/react-query Examples</h1>
      
      <section>
        <h2>Create Todo</h2>
        <CreateTodo />
      </section>

      <section>
        <h2>Todo List</h2>
        <TodoList />
      </section>

      <section>
        <h2>Todo Detail</h2>
        <input 
          placeholder="Enter todo ID" 
          onChange={(e) => setSelectedTodoId(e.target.value || null)}
        />
        <TodoDetail todoId={selectedTodoId} />
      </section>

      {selectedTodoId && (
        <section>
          <h2>Todo Actions</h2>
          <UpdateTodo todoId={selectedTodoId} />
          <OptimisticTodo todoId={selectedTodoId} />
        </section>
      )}

      <section>
        <h2>Cache Actions</h2>
        <TodoActions />
      </section>
    </div>
  );
} 