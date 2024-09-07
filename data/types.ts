import { DataModel } from './DataModel';
import { IndexSpecification } from 'mongodb';

export type DbIndex = IndexSpecification;

export type DataSource<T extends object> = {
  collectionName: string;
  ModelClass: typeof DataModel<T>;
  indexes: Array<DbIndex>;
};
