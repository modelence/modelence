# Function: modelenceQuery()

```ts
function modelenceQuery<T>(methodName, args): object;
```

Defined in: [index.ts:33](https://github.com/modelence/modelence/blob/547809fbbcff63781846ff984ba0b041aed1344a/packages/react-query/src/index.ts#L33)

Creates query options for use with TanStack Query's useQuery hook.

## Type Parameters

### T

`T` = `unknown`

The expected return type of the query

## Parameters

### methodName

`string`

The name of the method to query

### args

`Args` = `{}`

Optional arguments to pass to the method

## Returns

`object`

Query options object for TanStack Query's useQuery

### queryFn()

```ts
queryFn: () => Promise<T>;
```

#### Returns

`Promise`\<`T`\>

### queryKey

```ts
queryKey: (string | Args)[];
```

## Example

```tsx
import { useQuery } from '@tanstack/react-query';
import { modelenceQuery } from '@modelence/react-query';

function MyComponent() {
  // Basic usage
  const { data } = useQuery(modelenceQuery('todo.getAll'));

  // With additional options
  const { data: todo } = useQuery({
    ...modelenceQuery('todo.getById', { id: '123' }),
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
  });

  return <div>{data?.name}</div>;
}
```
