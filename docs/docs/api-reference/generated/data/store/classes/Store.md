[**modelence**](../../../README.md)

***

[modelence](../../../modules.md) / [data/store](../README.md) / Store

# Class: Store\<TSchema, TMethods\>

Defined in: [data/store.ts:48](https://github.com/modelence/modelence/blob/main/data/store.ts#L48)

The Store class provides a type-safe interface for MongoDB collections with built-in schema validation and helper methods.

## Example

```ts
const dbTodos = new Store('todos', {
  schema: {
    title: schema.string(),
    completed: schema.boolean(),
    dueDate: schema.date().optional(),
    userId: schema.userId(),
  },
  methods: {
    isOverdue() {
      return this.dueDate < new Date();
    }
  }
});
```

## Type Parameters

• **TSchema** *extends* `ModelSchema`

The document schema type

• **TMethods** *extends* `Record`\<`string`, (`this`, ...`args`) => `any`\>

Custom methods that will be added to documents

## Constructors

### new Store()

> **new Store**\<`TSchema`, `TMethods`\>(`name`, `options`): [`Store`](Store.md)\<`TSchema`, `TMethods`\>

Defined in: [data/store.ts:69](https://github.com/modelence/modelence/blob/main/data/store.ts#L69)

Creates a new Store instance

#### Parameters

##### name

`string`

The collection name in MongoDB

##### options

Store configuration

###### indexes

`IndexDescription`[]

MongoDB indexes to create

###### methods

`TMethods`

Custom methods to add to documents

###### schema

`TSchema`

Document schema using Modelence schema types

#### Returns

[`Store`](Store.md)\<`TSchema`, `TMethods`\>

## Properties

### \_doc

> `readonly` **\_doc**: `EnhancedOmit`\<`InferDocumentType`\<`TSchema`\>, `"_id"`\> & `object` & `TMethods` & `Record`\<`string`, `never`\>

Defined in: [data/store.ts:54](https://github.com/modelence/modelence/blob/main/data/store.ts#L54)

#### Type declaration

##### \_id

> **\_id**: `InferIdType`\<`InferDocumentType`\<`TSchema`\>\>

***

### \_rawDoc

> `readonly` **\_rawDoc**: `WithId`\<`InferDocumentType`\<`TSchema`\>\>

Defined in: [data/store.ts:53](https://github.com/modelence/modelence/blob/main/data/store.ts#L53)

***

### \_type

> `readonly` **\_type**: `InferDocumentType`\<`TSchema`\>

Defined in: [data/store.ts:52](https://github.com/modelence/modelence/blob/main/data/store.ts#L52)

***

### Doc

> `readonly` **Doc**: `EnhancedOmit`\<`InferDocumentType`\<`TSchema`\>, `"_id"`\> & `object` & `TMethods` & `Record`\<`string`, `never`\>

Defined in: [data/store.ts:55](https://github.com/modelence/modelence/blob/main/data/store.ts#L55)

#### Type declaration

##### \_id

> **\_id**: `InferIdType`\<`InferDocumentType`\<`TSchema`\>\>

## Methods

### aggregate()

> **aggregate**(`pipeline`, `options`?): `AggregationCursor`\<`Document`\>

Defined in: [data/store.ts:211](https://github.com/modelence/modelence/blob/main/data/store.ts#L211)

#### Parameters

##### pipeline

`Document`[]

##### options?

`AggregateOptions`

#### Returns

`AggregationCursor`\<`Document`\>

***

### bulkWrite()

> **bulkWrite**(`operations`): `Promise`\<`BulkWriteResult`\>

Defined in: [data/store.ts:215](https://github.com/modelence/modelence/blob/main/data/store.ts#L215)

#### Parameters

##### operations

`AnyBulkWriteOperation`\<`InferDocumentType`\<`TSchema`\>\>[]

#### Returns

`Promise`\<`BulkWriteResult`\>

***

### deleteMany()

> **deleteMany**(`selector`): `Promise`\<`DeleteResult`\>

Defined in: [data/store.ts:207](https://github.com/modelence/modelence/blob/main/data/store.ts#L207)

#### Parameters

##### selector

`Filter`\<`InferDocumentType`\<`TSchema`\>\>

#### Returns

`Promise`\<`DeleteResult`\>

***

### deleteOne()

> **deleteOne**(`selector`): `Promise`\<`DeleteResult`\>

Defined in: [data/store.ts:203](https://github.com/modelence/modelence/blob/main/data/store.ts#L203)

#### Parameters

##### selector

`Filter`\<`InferDocumentType`\<`TSchema`\>\>

#### Returns

`Promise`\<`DeleteResult`\>

***

### fetch()

> **fetch**(`query`, `options`?): `Promise`\<`EnhancedOmit`\<`InferDocumentType`\<`TSchema`\>, `"_id"`\> & `object` & `TMethods` & `Record`\<`string`, `never`\>[]\>

Defined in: [data/store.ts:171](https://github.com/modelence/modelence/blob/main/data/store.ts#L171)

#### Parameters

##### query

`Filter`\<`InferDocumentType`\<`TSchema`\>\>

##### options?

###### sort

`Document`

#### Returns

`Promise`\<`EnhancedOmit`\<`InferDocumentType`\<`TSchema`\>, `"_id"`\> & `object` & `TMethods` & `Record`\<`string`, `never`\>[]\>

***

### findById()

> **findById**(`id`): `Promise`\<`null` \| `EnhancedOmit`\<`InferDocumentType`\<`TSchema`\>, `"_id"`\> & `object` & `TMethods` & `Record`\<`string`, `never`\>\>

Defined in: [data/store.ts:158](https://github.com/modelence/modelence/blob/main/data/store.ts#L158)

#### Parameters

##### id

`string` | `ObjectId`

#### Returns

`Promise`\<`null` \| `EnhancedOmit`\<`InferDocumentType`\<`TSchema`\>, `"_id"`\> & `object` & `TMethods` & `Record`\<`string`, `never`\>\>

***

### findOne()

> **findOne**(`query`, `options`?): `Promise`\<`null` \| `EnhancedOmit`\<`InferDocumentType`\<`TSchema`\>, `"_id"`\> & `object` & `TMethods` & `Record`\<`string`, `never`\>\>

Defined in: [data/store.ts:129](https://github.com/modelence/modelence/blob/main/data/store.ts#L129)

#### Parameters

##### query

`Filter`\<`InferDocumentType`\<`TSchema`\>\>

##### options?

`FindOptions`

#### Returns

`Promise`\<`null` \| `EnhancedOmit`\<`InferDocumentType`\<`TSchema`\>, `"_id"`\> & `object` & `TMethods` & `Record`\<`string`, `never`\>\>

***

### getName()

> **getName**(): `string`

Defined in: [data/store.ts:86](https://github.com/modelence/modelence/blob/main/data/store.ts#L86)

#### Returns

`string`

***

### getSchema()

> **getSchema**(): `TSchema`

Defined in: [data/store.ts:90](https://github.com/modelence/modelence/blob/main/data/store.ts#L90)

#### Returns

`TSchema`

***

### insertMany()

> **insertMany**(`documents`): `Promise`\<`InsertManyResult`\>

Defined in: [data/store.ts:180](https://github.com/modelence/modelence/blob/main/data/store.ts#L180)

#### Parameters

##### documents

`OptionalUnlessRequiredId`\<`InferDocumentType`\<`TSchema`\>\>[]

#### Returns

`Promise`\<`InsertManyResult`\>

***

### insertOne()

> **insertOne**(`document`): `Promise`\<`InsertOneResult`\>

Defined in: [data/store.ts:176](https://github.com/modelence/modelence/blob/main/data/store.ts#L176)

#### Parameters

##### document

`OptionalUnlessRequiredId`\<`InferDocumentType`\<`TSchema`\>\>

#### Returns

`Promise`\<`InsertOneResult`\>

***

### provision()

> **provision**(`client`): `void`

Defined in: [data/store.ts:94](https://github.com/modelence/modelence/blob/main/data/store.ts#L94)

#### Parameters

##### client

`MongoClient`

#### Returns

`void`

***

### requireById()

> **requireById**(`id`, `errorHandler`?): `Promise`\<`EnhancedOmit`\<`InferDocumentType`\<`TSchema`\>, `"_id"`\> & `object` & `TMethods` & `Record`\<`string`, `never`\>\>

Defined in: [data/store.ts:163](https://github.com/modelence/modelence/blob/main/data/store.ts#L163)

#### Parameters

##### id

`string` | `ObjectId`

##### errorHandler?

() => `Error`

#### Returns

`Promise`\<`EnhancedOmit`\<`InferDocumentType`\<`TSchema`\>, `"_id"`\> & `object` & `TMethods` & `Record`\<`string`, `never`\>\>

***

### requireCollection()

> **requireCollection**(): `Collection`\<`InferDocumentType`\<`TSchema`\>\>

Defined in: [data/store.ts:121](https://github.com/modelence/modelence/blob/main/data/store.ts#L121)

#### Returns

`Collection`\<`InferDocumentType`\<`TSchema`\>\>

***

### requireOne()

> **requireOne**(`query`, `options`?, `errorHandler`?): `Promise`\<`EnhancedOmit`\<`InferDocumentType`\<`TSchema`\>, `"_id"`\> & `object` & `TMethods` & `Record`\<`string`, `never`\>\>

Defined in: [data/store.ts:137](https://github.com/modelence/modelence/blob/main/data/store.ts#L137)

#### Parameters

##### query

`Filter`\<`InferDocumentType`\<`TSchema`\>\>

##### options?

`FindOptions`

##### errorHandler?

() => `Error`

#### Returns

`Promise`\<`EnhancedOmit`\<`InferDocumentType`\<`TSchema`\>, `"_id"`\> & `object` & `TMethods` & `Record`\<`string`, `never`\>\>

***

### updateMany()

> **updateMany**(`selector`, `update`): `Promise`\<`UpdateResult`\>

Defined in: [data/store.ts:195](https://github.com/modelence/modelence/blob/main/data/store.ts#L195)

#### Parameters

##### selector

`Filter`\<`InferDocumentType`\<`TSchema`\>\>

##### update

`UpdateFilter`\<`InferDocumentType`\<`TSchema`\>\>

#### Returns

`Promise`\<`UpdateResult`\>

***

### updateOne()

> **updateOne**(`selector`, `update`): `Promise`\<`UpdateResult`\>

Defined in: [data/store.ts:184](https://github.com/modelence/modelence/blob/main/data/store.ts#L184)

#### Parameters

##### selector

`string` | `Filter`\<`InferDocumentType`\<`TSchema`\>\>

##### update

`UpdateFilter`\<`InferDocumentType`\<`TSchema`\>\>

#### Returns

`Promise`\<`UpdateResult`\>

***

### upsertMany()

> **upsertMany**(`selector`, `update`): `Promise`\<`UpdateResult`\>

Defined in: [data/store.ts:199](https://github.com/modelence/modelence/blob/main/data/store.ts#L199)

#### Parameters

##### selector

`Filter`\<`InferDocumentType`\<`TSchema`\>\>

##### update

`UpdateFilter`\<`InferDocumentType`\<`TSchema`\>\>

#### Returns

`Promise`\<`UpdateResult`\>

***

### upsertOne()

> **upsertOne**(`selector`, `update`): `Promise`\<`UpdateResult`\>

Defined in: [data/store.ts:191](https://github.com/modelence/modelence/blob/main/data/store.ts#L191)

#### Parameters

##### selector

`Filter`\<`InferDocumentType`\<`TSchema`\>\>

##### update

`UpdateFilter`\<`InferDocumentType`\<`TSchema`\>\>

#### Returns

`Promise`\<`UpdateResult`\>
