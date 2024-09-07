import { DataSource } from '../data/types';

export const db: Record<string, DataSource<any>> = {};

export function addDataSource(dataSource: DataSource<any>) {
  db[dataSource.collectionName] = dataSource;
}
