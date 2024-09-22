import { DataSource } from '../data/types';
import { MongoCollection } from './MongoCollection';
import { connect } from './client';
import { dataSources } from '../data/dataSources';

export const db: Record<string, MongoCollection> = {};

export async function initDb(mongodbUri: string) {
  const client = await connect(mongodbUri);

  Object.values(dataSources).forEach((dataSource: DataSource<any>) => {
    const collection = client.db().collection(dataSource.collectionName);
    db[dataSource.collectionName] = new MongoCollection(collection);
    dataSource.indexes.forEach((index) => {
      collection.createIndex(index);
    });
  });
}
