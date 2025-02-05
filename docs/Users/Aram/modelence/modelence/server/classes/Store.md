[**modelence**](../../../../../../Aram/modelence/modelence/README.md)

***

[modelence](../../../../../../Aram/modelence/modelence/README.md) / [../../../Users/Aram/modelence/modelence/server](../README.md) / Store

# Class: Store\<TSchema, TMethods\>

Defined in: [../../../Users/Aram/modelence/modelence/data/store.ts:48](https://github.com/modelence/modelence/blob/main/data/store.ts#L48)

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

```ts
new Store<TSchema, TMethods>(name, options): Store<TSchema, TMethods>
```

Defined in: [../../../Users/Aram/modelence/modelence/data/store.ts:73](https://github.com/modelence/modelence/blob/main/data/store.ts#L73)

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

## Methods

### aggregate()

```ts
aggregate(pipeline, options?): AggregationCursor<Document>
```

Defined in: [../../../Users/Aram/modelence/modelence/data/store.ts:297](https://github.com/modelence/modelence/blob/main/data/store.ts#L297)

Aggregates documents using MongoDB's aggregation framework

#### Parameters

##### pipeline

`Document`[]

The aggregation pipeline

##### options?

`AggregateOptions`

Optional options

#### Returns

`AggregationCursor`\<`Document`\>

The aggregation cursor

***

### bulkWrite()

```ts
bulkWrite(operations): Promise<BulkWriteResult>
```

Defined in: [../../../Users/Aram/modelence/modelence/data/store.ts:307](https://github.com/modelence/modelence/blob/main/data/store.ts#L307)

Performs a bulk write operation on the collection

#### Parameters

##### operations

`AnyBulkWriteOperation`\<`InferDocumentType`\<`TSchema`\>\>[]

The operations to perform

#### Returns

`Promise`\<`BulkWriteResult`\>

The result of the bulk write operation

***

### deleteMany()

```ts
deleteMany(selector): Promise<DeleteResult>
```

Defined in: [../../../Users/Aram/modelence/modelence/data/store.ts:286](https://github.com/modelence/modelence/blob/main/data/store.ts#L286)

Deletes multiple documents

#### Parameters

##### selector

`Filter`\<`InferDocumentType`\<`TSchema`\>\>

The selector to find the documents to delete

#### Returns

`Promise`\<`DeleteResult`\>

The result of the delete operation

***

### deleteOne()

```ts
deleteOne(selector): Promise<DeleteResult>
```

Defined in: [../../../Users/Aram/modelence/modelence/data/store.ts:276](https://github.com/modelence/modelence/blob/main/data/store.ts#L276)

Deletes a single document

#### Parameters

##### selector

`Filter`\<`InferDocumentType`\<`TSchema`\>\>

The selector to find the document to delete

#### Returns

`Promise`\<`DeleteResult`\>

The result of the delete operation

***

### fetch()

```ts
fetch(query, options?): Promise<EnhancedOmit<InferDocumentType<TSchema>, "_id"> & object & TMethods & Record<string, never>[]>
```

Defined in: [../../../Users/Aram/modelence/modelence/data/store.ts:198](https://github.com/modelence/modelence/blob/main/data/store.ts#L198)

Fetches multiple documents, equivalent to Node.js MongoDB driver's `find` and `toArray` methods combined.

#### Parameters

##### query

`Filter`\<`InferDocumentType`\<`TSchema`\>\>

The query to filter documents

##### options?

Optional options

###### sort

`Document`

#### Returns

`Promise`\<`EnhancedOmit`\<`InferDocumentType`\<`TSchema`\>, `"_id"`\> & `object` & `TMethods` & `Record`\<`string`, `never`\>[]\>

The documents

***

### findById()

```ts
findById(id): Promise<
  | null
| EnhancedOmit<InferDocumentType<TSchema>, "_id"> & object & TMethods & Record<string, never>>
```

Defined in: [../../../Users/Aram/modelence/modelence/data/store.ts:171](https://github.com/modelence/modelence/blob/main/data/store.ts#L171)

Fetches a single document by its ID

#### Parameters

##### id

The ID of the document to find

`string` | [`ObjectId`](ObjectId.md)

#### Returns

`Promise`\<
  \| `null`
  \| `EnhancedOmit`\<`InferDocumentType`\<`TSchema`\>, `"_id"`\> & `object` & `TMethods` & `Record`\<`string`, `never`\>\>

The document, or null if not found

***

### findOne()

```ts
findOne(query, options?): Promise<
  | null
| EnhancedOmit<InferDocumentType<TSchema>, "_id"> & object & TMethods & Record<string, never>>
```

Defined in: [../../../Users/Aram/modelence/modelence/data/store.ts:136](https://github.com/modelence/modelence/blob/main/data/store.ts#L136)

#### Parameters

##### query

`Filter`\<`InferDocumentType`\<`TSchema`\>\>

##### options?

`FindOptions`

#### Returns

`Promise`\<
  \| `null`
  \| `EnhancedOmit`\<`InferDocumentType`\<`TSchema`\>, `"_id"`\> & `object` & `TMethods` & `Record`\<`string`, `never`\>\>

***

### getName()

```ts
getName(): string
```

Defined in: [../../../Users/Aram/modelence/modelence/data/store.ts:90](https://github.com/modelence/modelence/blob/main/data/store.ts#L90)

#### Returns

`string`

***

### insertMany()

```ts
insertMany(documents): Promise<InsertManyResult>
```

Defined in: [../../../Users/Aram/modelence/modelence/data/store.ts:219](https://github.com/modelence/modelence/blob/main/data/store.ts#L219)

Inserts multiple documents

#### Parameters

##### documents

`OptionalUnlessRequiredId`\<`InferDocumentType`\<`TSchema`\>\>[]

The documents to insert

#### Returns

`Promise`\<`InsertManyResult`\>

The result of the insert operation

***

### insertOne()

```ts
insertOne(document): Promise<InsertOneResult>
```

Defined in: [../../../Users/Aram/modelence/modelence/data/store.ts:209](https://github.com/modelence/modelence/blob/main/data/store.ts#L209)

Inserts a single document

#### Parameters

##### document

`OptionalUnlessRequiredId`\<`InferDocumentType`\<`TSchema`\>\>

The document to insert

#### Returns

`Promise`\<`InsertOneResult`\>

The result of the insert operation

***

### requireById()

```ts
requireById(id, errorHandler?): Promise<EnhancedOmit<InferDocumentType<TSchema>, "_id"> & object & TMethods & Record<string, never>>
```

Defined in: [../../../Users/Aram/modelence/modelence/data/store.ts:183](https://github.com/modelence/modelence/blob/main/data/store.ts#L183)

Fetches a single document by its ID, or throws an error if not found

#### Parameters

##### id

The ID of the document to find

`string` | [`ObjectId`](ObjectId.md)

##### errorHandler?

() => `Error`

Optional error handler to return a custom error if the document is not found

#### Returns

`Promise`\<`EnhancedOmit`\<`InferDocumentType`\<`TSchema`\>, `"_id"`\> & `object` & `TMethods` & `Record`\<`string`, `never`\>\>

The document

***

### requireOne()

```ts
requireOne(
   query, 
   options?, 
errorHandler?): Promise<EnhancedOmit<InferDocumentType<TSchema>, "_id"> & object & TMethods & Record<string, never>>
```

Defined in: [../../../Users/Aram/modelence/modelence/data/store.ts:144](https://github.com/modelence/modelence/blob/main/data/store.ts#L144)

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

```ts
updateMany(selector, update): Promise<UpdateResult>
```

Defined in: [../../../Users/Aram/modelence/modelence/data/store.ts:255](https://github.com/modelence/modelence/blob/main/data/store.ts#L255)

Updates multiple documents

#### Parameters

##### selector

`Filter`\<`InferDocumentType`\<`TSchema`\>\>

The selector to find the documents to update

##### update

`UpdateFilter`\<`InferDocumentType`\<`TSchema`\>\>

The MongoDB modifier to apply to the documents

#### Returns

`Promise`\<`UpdateResult`\>

The result of the update operation

***

### updateOne()

```ts
updateOne(selector, update): Promise<UpdateResult>
```

Defined in: [../../../Users/Aram/modelence/modelence/data/store.ts:230](https://github.com/modelence/modelence/blob/main/data/store.ts#L230)

Updates a single document

#### Parameters

##### selector

The selector to find the document to update

`string` | `Filter`\<`InferDocumentType`\<`TSchema`\>\>

##### update

`UpdateFilter`\<`InferDocumentType`\<`TSchema`\>\>

The update to apply to the document

#### Returns

`Promise`\<`UpdateResult`\>

The result of the update operation

***

### upsertMany()

```ts
upsertMany(selector, update): Promise<UpdateResult>
```

Defined in: [../../../Users/Aram/modelence/modelence/data/store.ts:266](https://github.com/modelence/modelence/blob/main/data/store.ts#L266)

Updates multiple documents, or inserts them if they don't exist

#### Parameters

##### selector

`Filter`\<`InferDocumentType`\<`TSchema`\>\>

The selector to find the documents to update

##### update

`UpdateFilter`\<`InferDocumentType`\<`TSchema`\>\>

The MongoDB modifier to apply to the documents

#### Returns

`Promise`\<`UpdateResult`\>

The result of the update operation

***

### upsertOne()

```ts
upsertOne(selector, update): Promise<UpdateResult>
```

Defined in: [../../../Users/Aram/modelence/modelence/data/store.ts:244](https://github.com/modelence/modelence/blob/main/data/store.ts#L244)

Updates a single document, or inserts it if it doesn't exist

#### Parameters

##### selector

`Filter`\<`InferDocumentType`\<`TSchema`\>\>

The selector to find the document to update

##### update

`UpdateFilter`\<`InferDocumentType`\<`TSchema`\>\>

The MongoDB modifier to apply to the document

#### Returns

`Promise`\<`UpdateResult`\>

The result of the update operation

## Properties

### Doc

```ts
readonly Doc: EnhancedOmit<InferDocumentType<TSchema>, "_id"> & object & TMethods & Record<string, never>;
```

Defined in: [../../../Users/Aram/modelence/modelence/data/store.ts:59](https://github.com/modelence/modelence/blob/main/data/store.ts#L59)

#### Type declaration

##### \_id

```ts
_id: InferIdType<InferDocumentType<TSchema>>;
```
