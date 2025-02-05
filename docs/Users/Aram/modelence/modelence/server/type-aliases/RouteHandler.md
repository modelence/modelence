[**modelence**](../../../../../../Aram/modelence/modelence/README.md)

***

[modelence](../../../../../../Aram/modelence/modelence/README.md) / [../../../Users/Aram/modelence/modelence/server](../README.md) / RouteHandler

# Type Alias: RouteHandler()\<T\>

```ts
type RouteHandler<T> = (params) => Promise<RouteResponse<T>> | RouteResponse<T>;
```

Defined in: [../../../Users/Aram/modelence/modelence/routes/types.ts:21](https://github.com/modelence/modelence/blob/main/routes/types.ts#L21)

## Type Parameters

• **T** = `any`

## Parameters

### params

[`RouteParams`](RouteParams.md)

## Returns

`Promise`\<`RouteResponse`\<`T`\>\> \| `RouteResponse`\<`T`\>
