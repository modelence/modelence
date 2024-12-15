import { ObjectId } from 'mongodb';

type SingularSchemaTypeDefinition = ReturnType<typeof SchemaTypes[keyof typeof SchemaTypes]>;

type SchemaTypeDefinition = SingularSchemaTypeDefinition | [SingularSchemaTypeDefinition];

export const SchemaTypes = {
  Ref(storeName: string) {
    return {
      type: 'ref',
      ref: storeName,
    }
  },
  UserId() {
    return SchemaTypes.Ref('_modelenceUsers');
  },
  String(enumValues?: string[]) {
    return {
      type: 'string',
      enum: enumValues,
    }
  },
  Date() {
    return {
      type: 'date',
    }
  },
  Number() {
    return {
      type: 'number',
    }
  },
  Boolean() {
    return {
      type: 'boolean',
    }
  },
  Object() {
    return {
      type: 'object',
    }
  },
} as const;

// export type SchemaType = typeof SchemaTypes[keyof typeof SchemaTypes];

export type ModelSchema = Record<string, SchemaTypeDefinition>;

export type InferSchemaType<T extends Record<string, SchemaTypeDefinition>> = {
  [K in keyof T]: T[K] extends { type: 'string'; enum: string[] } ? T[K]['enum'][number] :
    T[K] extends { type: 'string' } ? string :
    T[K] extends { type: 'number' } ? number :
    T[K] extends { type: 'date' } ? Date :
    T[K] extends { type: 'boolean' } ? boolean :
    T[K] extends { type: 'ref' } ? import('mongodb').ObjectId :
    // T[K] extends { type: 'array' } ? Array<InferSchemaType<{ item: T[K]['items'] }>['item']> :
    // T[K] extends { type: 'object' } ? InferSchemaType<T[K]['properties']> :
    any;
};