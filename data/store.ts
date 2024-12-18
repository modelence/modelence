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
} from 'mongodb';
import { z } from 'zod';

import { ModelSchema } from './types';

export class Store<TSchema extends ModelSchema> {
  readonly _type!: z.infer<z.ZodObject<TSchema>>;

  private readonly name: string;
  private readonly schema: TSchema;
  private readonly indexes: IndexDescription[];
  private collection?: Collection<this['_type']>;

  constructor(
    name: string,
    { schema, indexes }: { schema: TSchema, indexes: IndexDescription[] }
  ) {
    this.name = name;
    this.schema = schema;
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

  requireCollection() {
    if (!this.collection) {
      throw new Error(`Collection ${this.name} is not provisioned`);
    }

    return this.collection;
  }

  async findOne(
    query: Filter<this['_type']>, 
    options?: FindOptions
  ): Promise<WithId<this['_type']> | null> {
    return await this.requireCollection().findOne(query, options);
  }

  find(query: Filter<this['_type']>, options?: { sort?: Document }) {
    const cursor = this.requireCollection().find(query);
    if (options?.sort) {
      cursor.sort(options.sort);
    }
    return cursor;
  }

  async fetch(query: Filter<this['_type']>, options?: { sort?: Document }): Promise<WithId<this['_type']>[]> {
    const cursor = this.find(query, options)
    return await cursor.toArray();
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
