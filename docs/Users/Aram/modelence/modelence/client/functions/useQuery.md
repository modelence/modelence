[**modelence**](../../../../../../Aram/modelence/modelence/README.md)

***

[modelence](../../../../../../Aram/modelence/modelence/README.md) / [../../../Users/Aram/modelence/modelence/client](../README.md) / useQuery

# Function: useQuery()

```ts
function useQuery<T>(methodName, args): MethodResult<T> & object
```

Defined in: [../../../Users/Aram/modelence/modelence/client/method.ts:96](https://github.com/modelence/modelence/blob/main/client/method.ts#L96)

React hook for executing a query method.

This hook automatically executes the query on mount and provides a refetch capability.
Similar to React Query's useQuery hook.

## Type Parameters

• **T** = `unknown`

The expected return type of the query

## Parameters

### methodName

`string`

The name of the method to query

### args

`Args` = `{}`

Optional arguments to pass to the method

## Returns

`MethodResult`\<`T`\> & `object`

An object containing the query state and a refetch function:
- `data` - The data returned by the query, or null if not yet loaded
- `isFetching` - Boolean indicating if the query is in progress
- `error` - Any error that occurred during the query, or null
- `refetch` - Function to manually trigger a refetch with optional new arguments

## Example

```tsx
function MyComponent() {
  // This is assuming you have a Module named "todo" with a query named "getItem"
  const { data, isFetching, error } = useQuery<Todo>('todo.getItem', { id: '123' });
  if (isFetching) {
    return <div>Loading...</div>;
  }
  if (error) {
    return <div>Error: {error.message}</div>;
  }
  return <div>{data?.name}</div>;
}
```
