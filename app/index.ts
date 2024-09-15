import { loadModels } from '../data/dataSources';
import { loadModules } from '../load';
import { connect } from '../db/client';
import { DataSource } from '../data/types';
import { addDataSource } from '../db';
import { startServer } from './server';

export async function startApp() {
  const dataSources = await loadModels();
  await loadModules('**/*(.actions|actions).{js,ts}');
  await loadModules('**/*(.loaders|loaders).{js,ts}');

  const client = await connect();

  Object.values(dataSources).forEach((dataSource: DataSource<any>) => {
    addDataSource(dataSource);
    dataSource.indexes.forEach((index) => {
      const collection = client.db().collection(dataSource.collectionName);
      collection.createIndex(index);
    });
  });

  await startServer();
}
