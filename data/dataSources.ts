import { DataSource } from './types';
import { loadModules } from '../load';

export async function loadModels() {
  const dataSources: Record<string, DataSource<any>> = {};
  
  const modules = await loadModules('**/*model.{js,ts}');
  for (const dataSource of modules) {
    dataSources[dataSource.collectionName] = dataSource;
  }
  return dataSources;
}
