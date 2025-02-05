[**modelence**](../../../../../../Aram/modelence/modelence/README.md)

***

[modelence](../../../../../../Aram/modelence/modelence/README.md) / [../../../Users/Aram/modelence/modelence/client](../README.md) / useMutation

# Function: useMutation()

```ts
function useMutation<T>(methodName, args): MethodResult<T> & object
```

Defined in: [../../../Users/Aram/modelence/modelence/client/method.ts:131](https://github.com/modelence/modelence/blob/main/client/method.ts#L131)

React hook for executing a mutation method.

This hook provides functions to trigger the mutation manually and handles loading/error states.
Similar to React Query's useMutation hook.

## Type Parameters

• **T** = `unknown`

The expected return type of the mutation

## Parameters

### methodName

`string`

The name of the method to mutate

### args

`Args` = `{}`

Optional default arguments to pass to the method

## Returns

`MethodResult`\<`T`\> & `object`

An object containing the mutation state and trigger functions:
- `data` - The data returned by the last successful mutation, or null
- `isFetching` - Boolean indicating if the mutation is in progress
- `error` - Any error that occurred during the last mutation, or null
- `mutate` - Function to trigger the mutation with optional arguments
- `mutateAsync` - Promise-returning version of mutate, useful for awaiting the result

## Example

```tsx
const { mutate: updateTodo, isFetching, error } = useMutation<User>('todos.update');

// Later in your code:
updateTodo({ id: '123', name: 'New Name' });
```
