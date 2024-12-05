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
} from 'mongodb';

import { ModelSchema } from './types';

export class Store<T extends object> {
  private readonly name: string;
  // TODO: have a single definition for types and schema (maybe zod?)
  private readonly schema: ModelSchema<T>;
  private readonly indexes: IndexDescription[];
  private collection?: Collection<T>;

  constructor(
    name: string,
    { schema, indexes }: { schema: ModelSchema<T>, indexes: IndexDescription[] }
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

    this.collection = client.db().collection(this.name);
    this.collection.createIndexes(this.indexes);
  }

  requireCollection() {
    if (!this.collection) {
      throw new Error(`Collection ${this.name} is not provisioned`);
    }

    return this.collection;
  }

  async findOne(
    query: Filter<T>, 
    options?: FindOptions
  ): Promise<WithId<T> | null> {
    return await this.requireCollection().findOne(query, options);
  }

  find(query: Filter<T>, options?: { sort?: Document }) {
    const cursor = this.requireCollection().find(query);
    if (options?.sort) {
      cursor.sort(options.sort);
    }
    return cursor;
  }

  async fetch(query: Filter<T>, options?: { sort?: Document }) {
    const cursor = this.find(query, options)
    return await cursor.toArray();
  }

  async insertOne(document: OptionalUnlessRequiredId<T>): Promise<InsertOneResult> {
    return await this.requireCollection().insertOne(document);
  }

  async updateOne(selector: Filter<T>, update: Document): Promise<UpdateResult> {
    return await this.requireCollection().updateOne(selector, update);
  }

  async upsertOne(selector: Filter<T>, update: Document): Promise<UpdateResult> {
    return await this.requireCollection().updateOne(selector, update, { upsert: true });
  }

  async updateMany(selector: Filter<T>, update: Document): Promise<UpdateResult> {
    return await this.requireCollection().updateMany(selector, update);
  }

  async upsertMany(selector: Filter<T>, update: Document): Promise<UpdateResult> {
    return await this.requireCollection().updateMany(selector, update, { upsert: true });
  }

  async deleteOne(selector: Filter<T>): Promise<DeleteResult> {
    return await this.requireCollection().deleteOne(selector);
  }

  async deleteMany(selector: Filter<T>): Promise<DeleteResult> {
    return await this.requireCollection().deleteMany(selector);
  }

  aggregate(pipeline: Document[], options?: AggregateOptions): AggregationCursor<Document> {
    return this.requireCollection().aggregate(pipeline, options);
  }

  // TODO: Add more methods as needed:
  // insertMany, updateMany, deleteMany, etc.
}
