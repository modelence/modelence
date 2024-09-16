import { DataSource } from '../data/types';
import { MongoCollection } from './MongoCollection';
import { getClient } from './client';

export const db: Record<string, MongoCollection> = {};

export function addDataSource(dataSource: DataSource<any>) {
  const client = getClient();
  if (!client) {
    throw new Error('Mongo client is not initialized');
  }
  const collection = client.db().collection(dataSource.collectionName);
  db[dataSource.collectionName] = new MongoCollection(collection);
}
