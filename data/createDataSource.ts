import { DataModel } from './DataModel';
import { DataSource, DbIndex, ModelSchema } from './types';

export function createDataSource<T extends object>(
  collectionName: string,
  ModelClass: typeof DataModel<T>,
  options: {
    schema: ModelSchema<T>;
    indexes: Array<ReturnType<typeof DbIndex>>;
  }
): DataSource<T> {
  return {
    collectionName,
    ModelClass,
    schema: options.schema,
    indexes: options.indexes,
  };
}
