# Function: modelenceMutation()

```ts
function modelenceMutation<T>(methodName, defaultArgs): object;
```

Defined in: [index.ts:74](https://github.com/modelence/modelence/blob/547809fbbcff63781846ff984ba0b041aed1344a/packages/react-query/src/index.ts#L74)

Creates mutation options for use with TanStack Query's useMutation hook.

## Type Parameters

### T

`T` = `unknown`

The expected return type of the mutation

## Parameters

### methodName

`string`

The name of the method to mutate

### defaultArgs

`Args` = `{}`

Optional default arguments to merge with mutation variables

## Returns

`object`

Mutation options object for TanStack Query's useMutation

### mutationFn()

```ts
mutationFn: (variables) => Promise<T>;
```

#### Parameters

##### variables

`Args` = `{}`

#### Returns

`Promise`\<`T`\>

## Example

```tsx
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { modelenceMutation } from '@modelence/react-query';

function MyComponent() {
  const queryClient = useQueryClient();
  
  // Basic usage
  const { mutate } = useMutation(modelenceMutation('todos.create'));

  // With additional options
  const { mutate: updateTodo } = useMutation({
    ...modelenceMutation('todos.update'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['todos.getAll'] });
    },
  });

  return <button onClick={() => mutate({ title: 'New Todo' })}>Create</button>;
}
```
