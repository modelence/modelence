import { DataSource } from './types';
import { loadModules } from '../load';

export const dataSources: Record<string, DataSource<any>> = {};

export async function loadModels() {  
  const modules = await loadModules('**/*model.{js,ts}');
  for (const dataSource of modules) {
    dataSources[dataSource.collectionName] = dataSource;
  }
  return dataSources;
}
