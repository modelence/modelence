import { DataModel } from './DataModel';
import { DataSource, DbIndex } from './types';

export function createDataSource<T extends object>(
  collectionName: string,
  ModelClass: typeof DataModel<T>,
  options: {
    indexes: Array<DbIndex>
  }
): DataSource<T> {
  return {
    collectionName,
    ModelClass,
    indexes: options.indexes
  };
}
