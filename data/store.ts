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
} from 'mongodb';

import { ModelSchema, InferDocumentType } from './types';

export class Store<
  TSchema extends ModelSchema,
  TMethods extends Record<string, (this: InferDocumentType<TSchema>, ...args: Parameters<any>) => any>
> {
  readonly _type!: InferDocumentType<TSchema>;
  readonly _rawDoc!: WithId<this['_type']>;
  readonly _doc!: this['_rawDoc'] & TMethods;

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
    if (this.methods) {
      return Object.assign(document, this.methods);
    }
    return document as this['_doc'];
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

  find(query: Filter<this['_type']>, options?: { sort?: Document }) {
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

  async updateOne(selector: Filter<this['_type']>, update: UpdateFilter<this['_type']>): Promise<UpdateResult> {
    return await this.requireCollection().updateOne(selector, update);
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

  // TODO: Add more methods as needed:
  // insertMany, updateMany, deleteMany, etc.
}
