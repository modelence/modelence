import { loadModels } from '../data/dataSources';
import { connect } from '../db/client';
import { DataSource } from '../data/types';
import { addDataSource } from '../db';

export async function startApp() {
  const dataSources = await loadModels();

  const client = await connect();

  Object.values(dataSources).forEach((dataSource: DataSource<any>) => {
    addDataSource(dataSource);
    dataSource.indexes.forEach((index) => {
      const collection = client.db().collection(dataSource.collectionName);
      collection.createIndex(index);
    });
  });
}
