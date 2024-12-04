import { IndexSpecification, CreateIndexesOptions } from 'mongodb';
import { SchemaTypes } from './SchemaTypes';

type ModelSchemaType<T> = 
  T extends string ? typeof SchemaTypes.String :
  T extends number ? typeof SchemaTypes.Number :
  T extends boolean ? typeof SchemaTypes.Boolean :
  T extends Date ? typeof SchemaTypes.Date :
  T extends Array<any> ? typeof SchemaTypes.Array :
  T extends object ? typeof SchemaTypes.Object :
  never;

export type ModelSchema<T> = {
  [K in keyof T]: ModelSchemaType<T[K]>
};

export function DbIndex(indexSpec: IndexSpecification, options?: CreateIndexesOptions) {
  return { indexSpec, options };
}
