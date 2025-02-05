[**modelence**](../../../../../../Aram/modelence/modelence/README.md)

***

[modelence](../../../../../../Aram/modelence/modelence/README.md) / [../../../Users/Aram/modelence/modelence/server](../README.md) / schema

# Variable: schema

```ts
const schema: object;
```

Defined in: [../../../Users/Aram/modelence/modelence/data/types.ts:31](https://github.com/modelence/modelence/blob/main/data/types.ts#L31)

## Type declaration

### array()

```ts
readonly array: <T>(schema, params?) => ZodArray<T> = schemaArray;
```

#### Type Parameters

• **T** *extends* `ZodTypeAny`

#### Parameters

##### schema

`T`

##### params?

`RawCreateParams`

#### Returns

`ZodArray`\<`T`\>

### boolean()

```ts
readonly boolean: (params?) => ZodBoolean = schemaBoolean;
```

#### Parameters

##### params?

`object` & `object`

#### Returns

`ZodBoolean`

### date()

```ts
readonly date: (params?) => ZodDate = schemaDate;
```

#### Parameters

##### params?

`object` & `object`

#### Returns

`ZodDate`

### enum()

```ts
readonly enum: <U, T>(values, params?) => ZodEnum<Writeable<T>><U, T>(values, params?) => ZodEnum<T> = schemaEnum;
```

#### Type Parameters

• **U** *extends* `string`

• **T** *extends* readonly \[`U`, `U`\]

#### Parameters

##### values

`T`

##### params?

`RawCreateParams`

#### Returns

`ZodEnum`\<`Writeable`\<`T`\>\>

#### Type Parameters

• **U** *extends* `string`

• **T** *extends* \[`U`, `...U[]`\]

#### Parameters

##### values

`T`

##### params?

`RawCreateParams`

#### Returns

`ZodEnum`\<`T`\>

### infer()

#### Type Parameters

• **T** *extends* `SchemaTypeDefinition`

#### Parameters

##### schema

`T`

#### Returns

`InferDocumentType`\<`T`\>

### number()

```ts
readonly number: (params?) => ZodNumber = schemaNumber;
```

#### Parameters

##### params?

`object` & `object`

#### Returns

`ZodNumber`

### object()

```ts
readonly object: <T>(shape, params?) => ZodObject<T, "strip", { [k in string | number | symbol]: addQuestionMarks<baseObjectOutputType<T>, any>[k] }, { [k in string | number | symbol]: baseObjectInputType<T>[k] }> = schemaObject;
```

#### Type Parameters

• **T** *extends* `ZodRawShape`

#### Parameters

##### shape

`T`

##### params?

`RawCreateParams`

#### Returns

`ZodObject`\<`T`, `"strip"`, \{ \[k in string \| number \| symbol\]: addQuestionMarks\<baseObjectOutputType\<T\>, any\>\[k\] \}, \{ \[k in string \| number \| symbol\]: baseObjectInputType\<T\>\[k\] \}\>

### objectId()

#### Returns

`ZodType`\<[`ObjectId`](../classes/ObjectId.md), [`ObjectId`](../classes/ObjectId.md)\>

### ref()

#### Parameters

##### collection

`string` | [`Store`](../classes/Store.md)\<`any`, `any`\>

#### Returns

`ZodType`\<[`ObjectId`](../classes/ObjectId.md), [`ObjectId`](../classes/ObjectId.md)\>

### string()

```ts
readonly string: (params?) => ZodString = schemaString;
```

#### Parameters

##### params?

`object` & `object`

#### Returns

`ZodString`

### union()

```ts
readonly union: <T>(types, params?) => ZodUnion<T>;
```

#### Type Parameters

• **T** *extends* readonly \[`ZodTypeAny`, `ZodTypeAny`, `ZodTypeAny`\]

#### Parameters

##### types

`T`

##### params?

`RawCreateParams`

#### Returns

`ZodUnion`\<`T`\>

### userId()

#### Returns

`ZodType`\<[`ObjectId`](../classes/ObjectId.md), [`ObjectId`](../classes/ObjectId.md)\>
