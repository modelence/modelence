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
} from 'mongodb';

import { ModelSchema, InferDocumentType } from './types';

export class Store<
  TSchema extends ModelSchema,
  TMethods extends Record<string, (this: InferDocumentType<TSchema>, ...args: Parameters<any>) => any>
> {
  readonly _type!: InferDocumentType<TSchema>;
  readonly _rawDoc!: WithId<this['_type']>;
  readonly _doc!: this['_rawDoc'] & TMethods & Record<string, never>;
  readonly Doc!: this['_doc'];

  private readonly name: string;
  private readonly schema: TSchema;
  private readonly methods?: TMethods;
  private readonly indexes: IndexDescription[];
  private collection?: Collection<this['_type']>;

  constructor(
    name: string,
    {
      schema,
      methods,
      indexes
    }: {
      schema: TSchema;
      methods?: TMethods;
      indexes: IndexDescription[];
    }
  ) {
    this.name = name;
    this.schema = schema;
    this.methods = methods;
    this.indexes = indexes;
  }

  getName() {
    return this.name;
  }

  getSchema() {
    return this.schema;
  }

  provision(client: MongoClient) {
    if (this.collection) {
      return;
    }

    this.collection = client.db().collection<this['_type']>(this.name);
    if (this.indexes.length > 0) {
      this.collection.createIndexes(this.indexes);
    }
  }

  private wrapDocument(document: this['_rawDoc']): this['_doc'] {
    const result = this.methods
      ? Object.assign(document, this.methods)
      : document;
    return result as this['_doc'] & Record<string, never>;
  }

  requireCollection() {
    if (!this.collection) {
      throw new Error(`Collection ${this.name} is not provisioned`);
    }

    return this.collection;
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

  private find(query: Filter<this['_type']>, options?: { sort?: Document }) {
    const cursor = this.requireCollection().find(query);
    if (options?.sort) {
      cursor.sort(options.sort);
    }
    return cursor;
  }

  async findById(id: string | ObjectId): Promise<this['_doc'] | null> {
    const idSelector = typeof id === 'string' ? { _id: new ObjectId(id) } : { _id: id };
    return await this.findOne(idSelector as Filter<this['_type']>);
  }

  async requireById(id: string | ObjectId, errorHandler?: () => Error): Promise<this['_doc']> {
    const result = await this.findById(id);
    if (!result) {
      throw errorHandler ? errorHandler() : new Error(`Record with id ${id} not found in ${this.name}`);
    }
    return result;
  }

  async fetch(query: Filter<this['_type']>, options?: { sort?: Document }): Promise<this['_doc'][]> {
    const cursor = this.find(query, options)
    return (await cursor.toArray()).map(this.wrapDocument.bind(this));
  }

  async insertOne(document: OptionalUnlessRequiredId<this['_type']>): Promise<InsertOneResult> {
    return await this.requireCollection().insertOne(document);
  }

  async insertMany(documents: OptionalUnlessRequiredId<this['_type']>[]): Promise<InsertManyResult> {
    return await this.requireCollection().insertMany(documents);
  }

  async updateOne(selector: Filter<this['_type']> | string, update: UpdateFilter<this['_type']>): Promise<UpdateResult> {
    const modifiedSelector = typeof selector === 'string' 
      ? { _id: new ObjectId(selector) } as Filter<this['_type']>
      : selector;
    return await this.requireCollection().updateOne(modifiedSelector, update);
  }

  async upsertOne(selector: Filter<this['_type']>, update: UpdateFilter<this['_type']>): Promise<UpdateResult> {
    return await this.requireCollection().updateOne(selector, update, { upsert: true });
  }

  async updateMany(selector: Filter<this['_type']>, update: UpdateFilter<this['_type']>): Promise<UpdateResult> {
    return await this.requireCollection().updateMany(selector, update);
  }

  async upsertMany(selector: Filter<this['_type']>, update: UpdateFilter<this['_type']>): Promise<UpdateResult> {
    return await this.requireCollection().updateMany(selector, update, { upsert: true });
  }

  async deleteOne(selector: Filter<this['_type']>): Promise<DeleteResult> {
    return await this.requireCollection().deleteOne(selector);
  }

  async deleteMany(selector: Filter<this['_type']>): Promise<DeleteResult> {
    return await this.requireCollection().deleteMany(selector);
  }

  aggregate(pipeline: Document[], options?: AggregateOptions): AggregationCursor<Document> {
    return this.requireCollection().aggregate(pipeline, options);
  }

  bulkWrite(operations: AnyBulkWriteOperation<this['_type']>[]): Promise<BulkWriteResult> {
    return this.requireCollection().bulkWrite(operations);
  }
}
