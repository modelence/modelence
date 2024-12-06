import { ObjectId } from 'mongodb';

export const SchemaTypes = {
  String: 'string',
  Date: 'date',
  Number: 'number',
  Boolean: 'boolean',
  Object: 'object',
  Array: 'array',
  ObjectId: 'objectId',
} as const;

export type SchemaType = typeof SchemaTypes[keyof typeof SchemaTypes];

type ModelSchemaType<T> = 
  T extends string ? typeof SchemaTypes.String :
  T extends number ? typeof SchemaTypes.Number :
  T extends boolean ? typeof SchemaTypes.Boolean :
  T extends Date ? typeof SchemaTypes.Date :
  T extends Array<any> ? typeof SchemaTypes.Array :
  T extends ObjectId ? typeof SchemaTypes.ObjectId :
  T extends object ? typeof SchemaTypes.Object :
  never;

export type ModelSchema<T> = {
  [K in keyof T]: ModelSchemaType<T[K]>
};
