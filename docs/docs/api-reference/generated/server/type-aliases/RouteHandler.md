[**modelence**](/docs/api-reference/README.md)

***

[modelence](/docs/api-reference/README.md) / [server](/docs/api-reference/server/README.md) / RouteHandler

# Type Alias: RouteHandler()\<T\>

```ts
type RouteHandler<T> = (params) => Promise<RouteResponse<T>> | RouteResponse<T>;
```

Defined in: [routes/types.ts:21](https://github.com/modelence/modelence/blob/main/routes/types.ts#L21)

## Type Parameters

• **T** = `any`

## Parameters

### params

[`RouteParams`](/docs/api-reference/server/type-aliases/RouteParams.md)

## Returns

`Promise`\<`RouteResponse`\<`T`\>\> \| `RouteResponse`\<`T`\>
