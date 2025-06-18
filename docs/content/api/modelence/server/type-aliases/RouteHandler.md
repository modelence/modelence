# Type Alias: RouteHandler()\<T\>

```ts
type RouteHandler<T> = (params) => 
  | Promise<RouteResponse<T>>
| RouteResponse<T>;
```

Defined in: [src/routes/types.ts:22](https://github.com/modelence/modelence/blob/547809fbbcff63781846ff984ba0b041aed1344a/packages/modelence/src/routes/types.ts#L22)

## Type Parameters

### T

`T` = `any`

## Parameters

### params

[`RouteParams`](/docs/api-reference/modelence/server/type-aliases/RouteParams.md)

## Returns

  \| `Promise`\<[`RouteResponse`](/docs/api-reference/modelence/server/type-aliases/RouteResponse.md)\<`T`\>\>
  \| [`RouteResponse`](/docs/api-reference/modelence/server/type-aliases/RouteResponse.md)\<`T`\>
