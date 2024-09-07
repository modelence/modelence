import { DataModel } from './DataModel';

export function createDataSource<T extends object>(
  collectionName: string,
  ModelClass: typeof DataModel<T>,
  options: {
    indexes: Array<{ [key: string]: 1 | -1 }>
  }
) {
  return {
    collectionName,
    ModelClass,
    indexes: options.indexes
  };
}
