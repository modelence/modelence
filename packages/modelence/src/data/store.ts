import {
  AggregateOptions,
  AggregationCursor,
  Collection,
  DeleteResult,
  Document,
  IndexDescription,
  InsertOneResult,
  MongoClient,
  UpdateResult,
  Filter,
  WithId,
  OptionalUnlessRequiredId,
  FindOptions,
  UpdateFilter,
  ObjectId,
  BulkWriteResult,
  AnyBulkWriteOperation,
  InsertManyResult,
  Db,
  ClientSession,
  SearchIndexDescription,
  MongoError,
} from 'mongodb';

import { ModelSchema, InferDocumentType } from './types';

/**
 * The Store class provides a type-safe interface for MongoDB collections with built-in schema validation and helper methods.
 * 
 * @category Store
 * @typeParam TSchema - The document schema type
 * @typeParam TMethods - Custom methods that will be added to documents
 * 
 * @example
 * ```ts
 * const dbTodos = new Store('todos', {
 *   schema: {
 *     title: schema.string(),
 *     completed: schema.boolean(),
 *     dueDate: schema.date().optional(),
 *     userId: schema.userId(),
 *   },
 *   methods: {
 *     isOverdue() {
 *       return this.dueDate < new Date();
 *     }
 *   }
 * });
 * ```
 */
export class Store<
  TSchema extends ModelSchema,
  TMethods extends Record<string, (this: WithId<InferDocumentType<TSchema>> & TMethods, ...args: Parameters<any>) => any>
> {
  /** @internal */
  readonly _type!: InferDocumentType<TSchema>;
  /** @internal */
  readonly _rawDoc!: WithId<this['_type']>;
  /** @internal */
  readonly _doc!: this['_rawDoc'] & TMethods;
  
  readonly Doc!: this['_doc'];

  private name: string;
  private readonly schema: TSchema;
  private readonly methods?: TMethods;
  private readonly indexes: IndexDescription[];
  private readonly searchIndexes: SearchIndexDescription[];
  private collection?: Collection<this['_type']>;
  private client?: MongoClient;

  /**
   * Creates a new Store instance
   * 
   * @param name - The collection name in MongoDB
   * @param options - Store configuration
   */
  constructor(
    name: string,
    options: {
      /** Document schema using Modelence schema types */
      schema: TSchema;
      /** Custom methods to add to documents */
      methods?: TMethods;
      /** MongoDB indexes to create */
      indexes: IndexDescription[];
      /** MongoDB Atlas Search */
      searchIndexes?: SearchIndexDescription[];
    }
  ) {
    this.name = name;
    this.schema = options.schema;
    this.methods = options.methods;
    this.indexes = options.indexes;
    this.searchIndexes = options.searchIndexes || [];
  }

  getName() {
    return this.name;
  }

  /** @internal */
  getSchema() {
    return this.schema;
  }

  /** @internal */
  init(client: MongoClient) {
    if (this.collection) {
      throw new Error(`Collection ${this.name} is already initialized`);
    }

    this.client = client;
    this.collection = this.client.db().collection<this['_type']>(this.name);
  }

  /** @internal */
  async createIndexes() {
    if (this.indexes.length > 0) {
      for (const index of this.indexes) {
        try {
          await this.requireCollection().createIndexes([index]);
        } catch (error) {
          if (error instanceof MongoError && error.code === 68 && index.name) {
            await this.requireCollection().dropIndex(index.name);
            await this.requireCollection().createIndexes([index]);
          } else {
            throw error;
          }
        }
      }
    }
    if (this.searchIndexes.length > 0) {
      for (const searchIndex of this.searchIndexes) {
        try {
          await this.requireCollection().createSearchIndexes([searchIndex]);
        } catch (error) {
          if (error instanceof MongoError && error.code === 68 && searchIndex.name) {
            await this.requireCollection().dropSearchIndex(searchIndex.name);
            await this.requireCollection().createSearchIndexes([searchIndex]);
          } else {
            throw error;
          }
        }
      }
    }
  }

  private wrapDocument(document: this['_rawDoc']): this['_doc'] {
    if (!this.methods) {
      return document as unknown as this['_doc'];
    }

    const result = Object.create(
      null,
      Object.getOwnPropertyDescriptors({
        ...document,
        ...this.methods
      })
    );

    return result as this['_doc'];
  }

  /**
   * For convenience, to also allow directy passing a string or ObjectId as the selector
  */
  private getSelector(selector: Filter<this['_type']> | string | ObjectId) {
    if (typeof selector === 'string') {
      return { _id: new ObjectId(selector) } as Filter<this['_type']>;
    }

    if (selector instanceof ObjectId) {
      return { _id: selector } as Filter<this['_type']>;
    }

    return selector;
  }

  /** @internal */
  requireCollection() {
    if (!this.collection) {
      throw new Error(`Collection ${this.name} is not provisioned`);
    }

    return this.collection;
  }

  /** @internal */
  requireClient() {
    if (!this.client) {
      throw new Error(`Database is not connected`);
    }

    return this.client;
  }

  async findOne(
    query: Filter<this['_type']>, 
    options?: FindOptions
  ) {
    const document = await this.requireCollection().findOne<this['_rawDoc']>(query, options);
    return document ? this.wrapDocument(document) : null;
  }

  async requireOne(
    query: Filter<this['_type']>, 
    options?: FindOptions,
    errorHandler?: () => Error
  ): Promise<this['_doc']> {
    
    const result = await this.findOne(query, options);
    if (!result) {
      throw errorHandler ? errorHandler() : new Error(`Record not found in ${this.name}`);
    }
    return result;
  }

  private find(query: Filter<this['_type']>, options?: { sort?: Document, limit?: number, skip?: number }) {
    const cursor = this.requireCollection().find(query);
    if (options?.sort) {
      cursor.sort(options.sort);
    }
    if (options?.limit) {
      cursor.limit(options.limit);
    }
    if (options?.skip) {
      cursor.skip(options.skip);
    }
    return cursor;
  }

  /**
   * Fetches a single document by its ID
   * 
   * @param id - The ID of the document to find
   * @returns The document, or null if not found
   */
  async findById(id: string | ObjectId): Promise<this['_doc'] | null> {
    const idSelector = typeof id === 'string' ? { _id: new ObjectId(id) } : { _id: id };
    return await this.findOne(idSelector as Filter<this['_type']>);
  }

  /**
   * Fetches a single document by its ID, or throws an error if not found
   * 
   * @param id - The ID of the document to find
   * @param errorHandler - Optional error handler to return a custom error if the document is not found
   * @returns The document
   */
  async requireById(id: string | ObjectId, errorHandler?: () => Error): Promise<this['_doc']> {
    const result = await this.findById(id);
    if (!result) {
      throw errorHandler ? errorHandler() : new Error(`Record with id ${id} not found in ${this.name}`);
    }
    return result;
  }

  /**
   * Counts the number of documents that match a query
   * 
   * @param query - The query to filter documents
   * @returns The number of documents that match the query
   */
  countDocuments(query: Filter<this['_type']>): Promise<number> {
    return this.requireCollection().countDocuments(query);
  }

  /**
   * Fetches multiple documents, equivalent to Node.js MongoDB driver's `find` and `toArray` methods combined.
   * 
   * @param query - The query to filter documents
   * @param options - Options
   * @returns The documents
   */
  async fetch(query: Filter<this['_type']>, options?: { sort?: Document, limit?: number, skip?: number }): Promise<this['_doc'][]> {
    const cursor = this.find(query, options)
    return (await cursor.toArray()).map(this.wrapDocument.bind(this));
  }

  /**
   * Inserts a single document
   * 
   * @param document - The document to insert
   * @returns The result of the insert operation
   */
  async insertOne(document: OptionalUnlessRequiredId<this['_type']>): Promise<InsertOneResult> {
    return await this.requireCollection().insertOne(document);
  }

  /**
   * Inserts multiple documents
   * 
   * @param documents - The documents to insert
   * @returns The result of the insert operation
   */
  async insertMany(documents: OptionalUnlessRequiredId<this['_type']>[]): Promise<InsertManyResult> {
    return await this.requireCollection().insertMany(documents);
  }

  /**
   * Updates a single document
   * 
   * @param selector - The selector to find the document to update
   * @param update - The update to apply to the document
   * @returns The result of the update operation
   */
  async updateOne(selector: Filter<this['_type']> | string | ObjectId, update: UpdateFilter<this['_type']>): Promise<UpdateResult> {
    return await this.requireCollection().updateOne(this.getSelector(selector), update);
  }

  /**
   * Updates a single document, or inserts it if it doesn't exist
   * 
   * @param selector - The selector to find the document to update
   * @param update - The MongoDB modifier to apply to the document
   * @returns The result of the update operation
   */
  async upsertOne(selector: Filter<this['_type']> | string | ObjectId, update: UpdateFilter<this['_type']>): Promise<UpdateResult> {
    return await this.requireCollection().updateOne(this.getSelector(selector), update, { upsert: true });
  }

  /**
   * Updates multiple documents
   * 
   * @param selector - The selector to find the documents to update
   * @param update - The MongoDB modifier to apply to the documents
   * @returns The result of the update operation
   */
  async updateMany(
    selector: Filter<this['_type']>, 
    update: UpdateFilter<this['_type']>, 
    options?: { session?: ClientSession }
  ): Promise<UpdateResult> {
    return await this.requireCollection().updateMany(selector, update, options);
  }

  /**
   * Updates multiple documents, or inserts them if they don't exist
   * 
   * @param selector - The selector to find the documents to update
   * @param update - The MongoDB modifier to apply to the documents
   * @returns The result of the update operation
   */
  async upsertMany(selector: Filter<this['_type']>, update: UpdateFilter<this['_type']>): Promise<UpdateResult> {
    return await this.requireCollection().updateMany(selector, update, { upsert: true });
  }

  /**
   * Deletes a single document
   * 
   * @param selector - The selector to find the document to delete
   * @returns The result of the delete operation
   */
  async deleteOne(selector: Filter<this['_type']>): Promise<DeleteResult> {
    return await this.requireCollection().deleteOne(selector);
  }

  /**
   * Deletes multiple documents
   * 
   * @param selector - The selector to find the documents to delete
   * @returns The result of the delete operation
   */
  async deleteMany(selector: Filter<this['_type']>): Promise<DeleteResult> {
    return await this.requireCollection().deleteMany(selector);
  }

  /**
   * Aggregates documents using MongoDB's aggregation framework
   * 
   * @param pipeline - The aggregation pipeline
   * @param options - Optional options
   * @returns The aggregation cursor
   */
  aggregate(pipeline: Document[], options?: AggregateOptions): AggregationCursor<Document> {
    return this.requireCollection().aggregate(pipeline, options);
  }

  /**
   * Performs a bulk write operation on the collection
   * 
   * @param operations - The operations to perform
   * @returns The result of the bulk write operation
   */
  bulkWrite(operations: AnyBulkWriteOperation<this['_type']>[]): Promise<BulkWriteResult> {
    return this.requireCollection().bulkWrite(operations);
  }

  /**
   * Returns the raw MongoDB database instance for advanced operations
   * @returns The MongoDB database instance
   * @throws Error if the store is not provisioned
   */
  getDatabase() {
    return this.requireClient().db();
  }

  /**
   * Returns the raw MongoDB collection instance for advanced operations
   * @returns The MongoDB collection instance
   * @throws Error if the store is not provisioned
   */
  rawCollection() {
    return this.requireCollection();
  }

  /**
   * Renames an existing collection to this store's name, used for migrations
   * @param oldName - The previous name of the collection
   * @throws Error if the old collection doesn't exist or if this store's collection already exists
   */
  async renameFrom(oldName: string, options?: { session?: ClientSession }) {
    const db = this.getDatabase();

    if (!this.collection || !db) {
      throw new Error(`Store ${this.name} is not provisioned`);
    }

    const oldCollections = await db.listCollections({ name: oldName }).toArray();
    if (oldCollections.length === 0) {
      throw new Error(`Collection ${oldName} not found`);
    }

    const newCollections = await db.listCollections({ name: this.name }).toArray();
    if (newCollections.length > 0) {
      throw new Error(`Collection ${this.name} already exists`);
    }

    const existingCollection = db.collection<this['_type']>(oldName);

    await existingCollection.rename(this.name, options);
  }

  async vectorSearch({
    field,
    embedding,
    numCandidates,
    limit,
    projection,
  }: {
    field: string,
    embedding: number[],
    numCandidates?: number;
    limit?: number;
    projection?: Document;
  }) {
    return this.aggregate([
      {
        $vectorSearch: {
          index: field + 'VectorSearch',
          path: field,
          queryVector: embedding,
          numCandidates: numCandidates || 100,
          limit: limit || 10,
        }
      },
      {
        $project: {
          _id: 1,
          score: { $meta: 'vectorSearchScore' },
          ...projection,
        }
      }
    ]);
  }

  static vectorIndex({
    field,
    dimensions,
    similarity = 'cosine',
  }: {
    field: string;
    dimensions: number;
    similarity?: 'cosine' | 'euclidean' | 'dotProduct';
  }) {
    return {
      type: 'vectorSearch',
      name: field + 'VectorSearch',
      definition: {
        fields: [{
          type: 'vector',
          path: field,
          numDimensions: dimensions,
          similarity,
        }],
      },
    };
  }
}
