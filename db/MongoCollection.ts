import { Collection, Document, UpdateResult, DeleteResult, InsertOneResult, AggregateOptions, AggregationCursor, FindCursor } from 'mongodb';

export class MongoCollection {
  private collection: Collection;

  constructor(collection: Collection) {
    this.collection = collection;
  }

  async findOne(query: Document, options?: { sort?: Document }): Promise<Document | null> {
    return await this.collection.findOne(query, options);
  }

  find(query: Document, options?: { sort?: Document }): FindCursor<Document> {
    const cursor = this.collection.find(query);
    if (options?.sort) {
      cursor.sort(options.sort);
    }
    return cursor;
  }

  async fetch(query: Document, options?: { sort?: Document }): Promise<Document[]> {
    const cursor = this.find(query, options)
    return await cursor.toArray();
  }

  async insertOne(document: Document): Promise<InsertOneResult> {
    return await this.collection.insertOne(document);
  }

  async updateOne(selector: Document, update: Document): Promise<UpdateResult> {
    return await this.collection.updateOne(selector, update);
  }

  async updateMany(selector: Document, update: Document): Promise<UpdateResult> {
    return await this.collection.updateMany(selector, update);
  }

  async upsertMany(selector: Document, update: Document): Promise<UpdateResult> {
    return await this.collection.updateMany(selector, update, { upsert: true });
  }

  async deleteOne(selector: Document): Promise<DeleteResult> {
    return await this.collection.deleteOne(selector);
  }

  async deleteMany(selector: Document): Promise<DeleteResult> {
    return await this.collection.deleteMany(selector);
  }

  aggregate(pipeline: Document[], options?: AggregateOptions): AggregationCursor<Document> {
    return this.collection.aggregate(pipeline, options);
  }

  // TODO: Add more methods as needed:
  // insertMany, updateMany, deleteMany, etc.
}
