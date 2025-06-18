# Class: Store\<TSchema, TMethods\>

Defined in: [src/data/store.ts:50](https://github.com/modelence/modelence/blob/547809fbbcff63781846ff984ba0b041aed1344a/packages/modelence/src/data/store.ts#L50)

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

### TSchema

`TSchema` *extends* `ModelSchema`

The document schema type

### TMethods

`TMethods` *extends* `Record`\<`string`, (`this`, ...`args`) => `any`\>

Custom methods that will be added to documents

## Constructors

### Constructor

```ts
new Store<TSchema, TMethods>(name, options): Store<TSchema, TMethods>;
```

Defined in: [src/data/store.ts:76](https://github.com/modelence/modelence/blob/547809fbbcff63781846ff984ba0b041aed1344a/packages/modelence/src/data/store.ts#L76)

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

###### methods?

`TMethods`

Custom methods to add to documents

###### schema

`TSchema`

Document schema using Modelence schema types

#### Returns

`Store`\<`TSchema`, `TMethods`\>

## Properties

### Doc

```ts
readonly Doc: EnhancedOmit<InferDocumentType<TSchema>, "_id"> & object & TMethods;
```

Defined in: [src/data/store.ts:61](https://github.com/modelence/modelence/blob/547809fbbcff63781846ff984ba0b041aed1344a/packages/modelence/src/data/store.ts#L61)

## Methods

### aggregate()

```ts
aggregate(pipeline, options?): AggregationCursor<Document>;
```

Defined in: [src/data/store.ts:324](https://github.com/modelence/modelence/blob/547809fbbcff63781846ff984ba0b041aed1344a/packages/modelence/src/data/store.ts#L324)

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
bulkWrite(operations): Promise<BulkWriteResult>;
```

Defined in: [src/data/store.ts:334](https://github.com/modelence/modelence/blob/547809fbbcff63781846ff984ba0b041aed1344a/packages/modelence/src/data/store.ts#L334)

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
deleteMany(selector): Promise<DeleteResult>;
```

Defined in: [src/data/store.ts:313](https://github.com/modelence/modelence/blob/547809fbbcff63781846ff984ba0b041aed1344a/packages/modelence/src/data/store.ts#L313)

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
deleteOne(selector): Promise<DeleteResult>;
```

Defined in: [src/data/store.ts:303](https://github.com/modelence/modelence/blob/547809fbbcff63781846ff984ba0b041aed1344a/packages/modelence/src/data/store.ts#L303)

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
fetch(query, options?): Promise<EnhancedOmit<InferDocumentType<TSchema>, "_id"> & object & TMethods[]>;
```

Defined in: [src/data/store.ts:221](https://github.com/modelence/modelence/blob/547809fbbcff63781846ff984ba0b041aed1344a/packages/modelence/src/data/store.ts#L221)

Fetches multiple documents, equivalent to Node.js MongoDB driver's `find` and `toArray` methods combined.

#### Parameters

##### query

`Filter`\<`InferDocumentType`\<`TSchema`\>\>

The query to filter documents

##### options?

Optional options

###### limit?

`number`

###### skip?

`number`

###### sort?

`Document`

#### Returns

`Promise`\<`EnhancedOmit`\<`InferDocumentType`\<`TSchema`\>, `"_id"`\> & `object` & `TMethods`[]\>

The documents

***

### findById()

```ts
findById(id): Promise<
  | null
| EnhancedOmit<InferDocumentType<TSchema>, "_id"> & object & TMethods>;
```

Defined in: [src/data/store.ts:194](https://github.com/modelence/modelence/blob/547809fbbcff63781846ff984ba0b041aed1344a/packages/modelence/src/data/store.ts#L194)

Fetches a single document by its ID

#### Parameters

##### id

The ID of the document to find

`string` | `ObjectId`

#### Returns

`Promise`\<
  \| `null`
  \| `EnhancedOmit`\<`InferDocumentType`\<`TSchema`\>, `"_id"`\> & `object` & `TMethods`\>

The document, or null if not found

***

### findOne()

```ts
findOne(query, options?): Promise<
  | null
| EnhancedOmit<InferDocumentType<TSchema>, "_id"> & object & TMethods>;
```

Defined in: [src/data/store.ts:153](https://github.com/modelence/modelence/blob/547809fbbcff63781846ff984ba0b041aed1344a/packages/modelence/src/data/store.ts#L153)

#### Parameters

##### query

`Filter`\<`InferDocumentType`\<`TSchema`\>\>

##### options?

`FindOptions`\<`Document`\>

#### Returns

`Promise`\<
  \| `null`
  \| `EnhancedOmit`\<`InferDocumentType`\<`TSchema`\>, `"_id"`\> & `object` & `TMethods`\>

***

### getDatabase()

```ts
getDatabase(): Db;
```

Defined in: [src/data/store.ts:343](https://github.com/modelence/modelence/blob/547809fbbcff63781846ff984ba0b041aed1344a/packages/modelence/src/data/store.ts#L343)

Returns the raw MongoDB database instance for advanced operations

#### Returns

`Db`

The MongoDB database instance

#### Throws

Error if the store is not provisioned

***

### getName()

```ts
getName(): string;
```

Defined in: [src/data/store.ts:93](https://github.com/modelence/modelence/blob/547809fbbcff63781846ff984ba0b041aed1344a/packages/modelence/src/data/store.ts#L93)

#### Returns

`string`

***

### insertMany()

```ts
insertMany(documents): Promise<InsertManyResult<Document>>;
```

Defined in: [src/data/store.ts:242](https://github.com/modelence/modelence/blob/547809fbbcff63781846ff984ba0b041aed1344a/packages/modelence/src/data/store.ts#L242)

Inserts multiple documents

#### Parameters

##### documents

`OptionalUnlessRequiredId`\<`InferDocumentType`\<`TSchema`\>\>[]

The documents to insert

#### Returns

`Promise`\<`InsertManyResult`\<`Document`\>\>

The result of the insert operation

***

### insertOne()

```ts
insertOne(document): Promise<InsertOneResult<Document>>;
```

Defined in: [src/data/store.ts:232](https://github.com/modelence/modelence/blob/547809fbbcff63781846ff984ba0b041aed1344a/packages/modelence/src/data/store.ts#L232)

Inserts a single document

#### Parameters

##### document

`OptionalUnlessRequiredId`\<`InferDocumentType`\<`TSchema`\>\>

The document to insert

#### Returns

`Promise`\<`InsertOneResult`\<`Document`\>\>

The result of the insert operation

***

### rawCollection()

```ts
rawCollection(): Collection<InferDocumentType<TSchema>>;
```

Defined in: [src/data/store.ts:352](https://github.com/modelence/modelence/blob/547809fbbcff63781846ff984ba0b041aed1344a/packages/modelence/src/data/store.ts#L352)

Returns the raw MongoDB collection instance for advanced operations

#### Returns

`Collection`\<`InferDocumentType`\<`TSchema`\>\>

The MongoDB collection instance

#### Throws

Error if the store is not provisioned

***

### renameFrom()

```ts
renameFrom(oldName, options?): Promise<void>;
```

Defined in: [src/data/store.ts:361](https://github.com/modelence/modelence/blob/547809fbbcff63781846ff984ba0b041aed1344a/packages/modelence/src/data/store.ts#L361)

Renames an existing collection to this store's name, used for migrations

#### Parameters

##### oldName

`string`

The previous name of the collection

##### options?

###### session?

`ClientSession`

#### Returns

`Promise`\<`void`\>

#### Throws

Error if the old collection doesn't exist or if this store's collection already exists

***

### requireById()

```ts
requireById(id, errorHandler?): Promise<EnhancedOmit<InferDocumentType<TSchema>, "_id"> & object & TMethods>;
```

Defined in: [src/data/store.ts:206](https://github.com/modelence/modelence/blob/547809fbbcff63781846ff984ba0b041aed1344a/packages/modelence/src/data/store.ts#L206)

Fetches a single document by its ID, or throws an error if not found

#### Parameters

##### id

The ID of the document to find

`string` | `ObjectId`

##### errorHandler?

() => `Error`

Optional error handler to return a custom error if the document is not found

#### Returns

`Promise`\<`EnhancedOmit`\<`InferDocumentType`\<`TSchema`\>, `"_id"`\> & `object` & `TMethods`\>

The document

***

### requireOne()

```ts
requireOne(
   query, 
   options?, 
errorHandler?): Promise<EnhancedOmit<InferDocumentType<TSchema>, "_id"> & object & TMethods>;
```

Defined in: [src/data/store.ts:161](https://github.com/modelence/modelence/blob/547809fbbcff63781846ff984ba0b041aed1344a/packages/modelence/src/data/store.ts#L161)

#### Parameters

##### query

`Filter`\<`InferDocumentType`\<`TSchema`\>\>

##### options?

`FindOptions`\<`Document`\>

##### errorHandler?

() => `Error`

#### Returns

`Promise`\<`EnhancedOmit`\<`InferDocumentType`\<`TSchema`\>, `"_id"`\> & `object` & `TMethods`\>

***

### updateMany()

```ts
updateMany(
   selector, 
   update, 
options?): Promise<UpdateResult<Document>>;
```

Defined in: [src/data/store.ts:278](https://github.com/modelence/modelence/blob/547809fbbcff63781846ff984ba0b041aed1344a/packages/modelence/src/data/store.ts#L278)

Updates multiple documents

#### Parameters

##### selector

`Filter`\<`InferDocumentType`\<`TSchema`\>\>

The selector to find the documents to update

##### update

`UpdateFilter`\<`InferDocumentType`\<`TSchema`\>\>

The MongoDB modifier to apply to the documents

##### options?

###### session?

`ClientSession`

#### Returns

`Promise`\<`UpdateResult`\<`Document`\>\>

The result of the update operation

***

### updateOne()

```ts
updateOne(selector, update): Promise<UpdateResult<Document>>;
```

Defined in: [src/data/store.ts:253](https://github.com/modelence/modelence/blob/547809fbbcff63781846ff984ba0b041aed1344a/packages/modelence/src/data/store.ts#L253)

Updates a single document

#### Parameters

##### selector

The selector to find the document to update

`string` | `Filter`\<`InferDocumentType`\<`TSchema`\>\>

##### update

`UpdateFilter`\<`InferDocumentType`\<`TSchema`\>\>

The update to apply to the document

#### Returns

`Promise`\<`UpdateResult`\<`Document`\>\>

The result of the update operation

***

### upsertMany()

```ts
upsertMany(selector, update): Promise<UpdateResult<Document>>;
```

Defined in: [src/data/store.ts:293](https://github.com/modelence/modelence/blob/547809fbbcff63781846ff984ba0b041aed1344a/packages/modelence/src/data/store.ts#L293)

Updates multiple documents, or inserts them if they don't exist

#### Parameters

##### selector

`Filter`\<`InferDocumentType`\<`TSchema`\>\>

The selector to find the documents to update

##### update

`UpdateFilter`\<`InferDocumentType`\<`TSchema`\>\>

The MongoDB modifier to apply to the documents

#### Returns

`Promise`\<`UpdateResult`\<`Document`\>\>

The result of the update operation

***

### upsertOne()

```ts
upsertOne(selector, update): Promise<UpdateResult<Document>>;
```

Defined in: [src/data/store.ts:267](https://github.com/modelence/modelence/blob/547809fbbcff63781846ff984ba0b041aed1344a/packages/modelence/src/data/store.ts#L267)

Updates a single document, or inserts it if it doesn't exist

#### Parameters

##### selector

`Filter`\<`InferDocumentType`\<`TSchema`\>\>

The selector to find the document to update

##### update

`UpdateFilter`\<`InferDocumentType`\<`TSchema`\>\>

The MongoDB modifier to apply to the document

#### Returns

`Promise`\<`UpdateResult`\<`Document`\>\>

The result of the update operation
