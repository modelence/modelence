# Function: createQueryKey()

```ts
function createQueryKey<T, U>(methodName, args): ModelenceQueryKey<T, U>;
```

Defined in: [index.ts:111](https://github.com/modelence/modelence/blob/547809fbbcff63781846ff984ba0b041aed1344a/packages/react-query/src/index.ts#L111)

Utility function to create query keys for manual cache operations

## Type Parameters

### T

`T` *extends* `string`

### U

`U` *extends* `Args` = `Args`

## Parameters

### methodName

`T`

The method name

### args

`U` = `...`

The arguments

## Returns

[`ModelenceQueryKey`](/docs/api-reference/@modelence/react-query/type-aliases/ModelenceQueryKey.md)\<`T`, `U`\>

Typed query key

## Example

```tsx
import { useQueryClient } from '@tanstack/react-query';
import { createQueryKey } from '@modelence/react-query';

function TodoActions() {
  const queryClient = useQueryClient();
  
  const refreshTodos = () => {
    queryClient.invalidateQueries({ 
      queryKey: createQueryKey('todo.getAll', { limit: 10 }) 
    });
  };
}
```
