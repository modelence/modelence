import { Collection, Document, UpdateResult, DeleteResult, InsertOneResult } from 'mongodb';

export class MongoCollection {
  private collection: Collection;

  constructor(collection: Collection) {
    this.collection = collection;
  }

  async findOne(query: Document, options?: { sort?: Document }): Promise<Document | null> {
    return await this.collection.findOne(query, options);
  }

  async find(query: Document,  options?: { sort?: Document }): Promise<Document[]> {
    const cursor = this.collection.find(query);
    if (options?.sort) {
      cursor.sort(options.sort);
    }
    return await cursor.toArray();
  }

  async insertOne(document: Document): Promise<InsertOneResult> {
    return await this.collection.insertOne(document);
  }

  async updateOne(selector: Document, update: Document): Promise<UpdateResult> {
    return await this.collection.updateOne(selector, update);
  }

  async deleteOne(selector: Document): Promise<DeleteResult> {
    return await this.collection.deleteOne(selector);
  }

  // TODO: Add more methods as needed:
  // insertMany, updateMany, deleteMany, aggregate, etc.
}
