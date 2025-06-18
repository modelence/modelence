# Variable: schema

```ts
const schema: object;
```

Defined in: [src/data/types.ts:31](https://github.com/modelence/modelence/blob/547809fbbcff63781846ff984ba0b041aed1344a/packages/modelence/src/data/types.ts#L31)

## Type declaration

### array()

```ts
readonly array: <El>(schema, params?) => ZodArray<El> = schemaArray;
```

#### Type Parameters

##### El

`El` *extends* `ZodTypeAny`

#### Parameters

##### schema

`El`

##### params?

`RawCreateParams`

#### Returns

`ZodArray`\<`El`\>

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
readonly enum: {
<U, T>  (values, params?): ZodEnum<Writeable<T>>;
<U, T>  (values, params?): ZodEnum<T>;
} = schemaEnum;
```

#### Call Signature

```ts
<U, T>(values, params?): ZodEnum<Writeable<T>>;
```

##### Type Parameters

###### U

`U` *extends* `string`

###### T

`T` *extends* readonly \[`U`, `U`\]

##### Parameters

###### values

`T`

###### params?

`RawCreateParams`

##### Returns

`ZodEnum`\<`Writeable`\<`T`\>\>

#### Call Signature

```ts
<U, T>(values, params?): ZodEnum<T>;
```

##### Type Parameters

###### U

`U` *extends* `string`

###### T

`T` *extends* \[`U`, `...U[]`\]

##### Parameters

###### values

`T`

###### params?

`RawCreateParams`

##### Returns

`ZodEnum`\<`T`\>

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
readonly object: <Shape>(shape, params?) => ZodObject<Shape, "strip", ZodTypeAny, { [k in string | number | symbol]: addQuestionMarks<baseObjectOutputType<Shape>, any>[k] }, { [k in string | number | symbol]: baseObjectInputType<Shape>[k] }> = schemaObject;
```

#### Type Parameters

##### Shape

`Shape` *extends* `ZodRawShape`

#### Parameters

##### shape

`Shape`

##### params?

`RawCreateParams`

#### Returns

`ZodObject`\<`Shape`, `"strip"`, `ZodTypeAny`, \{ \[k in string \| number \| symbol\]: addQuestionMarks\<baseObjectOutputType\<Shape\>, any\>\[k\] \}, \{ \[k in string \| number \| symbol\]: baseObjectInputType\<Shape\>\[k\] \}\>

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
readonly union: <Options>(types, params?) => ZodUnion<Options>;
```

#### Type Parameters

##### Options

`Options` *extends* readonly \[`ZodTypeAny`, `ZodTypeAny`, `ZodTypeAny`\]

#### Parameters

##### types

`Options`

##### params?

`RawCreateParams`

#### Returns

`ZodUnion`\<`Options`\>

### infer()

```ts
readonly infer<T>(schema): InferDocumentType<T>;
```

#### Type Parameters

##### T

`T` *extends* `SchemaTypeDefinition`

#### Parameters

##### schema

`T`

#### Returns

`InferDocumentType`\<`T`\>

### objectId()

```ts
readonly objectId(): ZodType<ObjectId>;
```

#### Returns

`ZodType`\<`ObjectId`\>

### ref()

```ts
readonly ref(collection): ZodType<ObjectId>;
```

#### Parameters

##### collection

`string` | [`Store`](/docs/api-reference/modelence/server/classes/Store.md)\<`any`, `any`\>

#### Returns

`ZodType`\<`ObjectId`\>

### userId()

```ts
readonly userId(): ZodType<ObjectId>;
```

#### Returns

`ZodType`\<`ObjectId`\>
