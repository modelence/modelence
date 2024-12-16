import { ObjectId } from 'mongodb';
import { z } from 'zod';

type SingularSchemaTypeDefinition = ReturnType<typeof schema[keyof typeof schema]>;

type SchemaTypeDefinition = SingularSchemaTypeDefinition | [SingularSchemaTypeDefinition];

export type ModelSchema = Record<string, SchemaTypeDefinition>;

export type InferSchemaType<T extends Record<string, SchemaTypeDefinition>> = {
  [K in keyof T]: T[K] extends { type: 'string'; enum: string[] } ? T[K]['enum'][number] :
    T[K] extends { type: 'string' } ? string :
    T[K] extends { type: 'number' } ? number :
    T[K] extends { type: 'date' } ? Date :
    T[K] extends { type: 'boolean' } ? boolean :
    T[K] extends { type: 'ref' } ? ObjectId :
    // T[K] extends { type: 'array' } ? Array<InferSchemaType<{ item: T[K]['items'] }>['item']> :
    // T[K] extends { type: 'object' } ? InferSchemaType<T[K]['properties']> :
    any;
};

const schemaString: typeof z.string = z.string.bind(z);

const schemaNumber: typeof z.number = z.number.bind(z);

const schemaDate: typeof z.date = z.date.bind(z);

const schemaBoolean: typeof z.boolean = z.boolean.bind(z);

const schemaObject: typeof z.object = z.object.bind(z);

const schemaEnum: typeof z.enum = z.enum.bind(z);

export const schema = {
  string: schemaString,
  number: schemaNumber,
  date: schemaDate,
  boolean: schemaBoolean,
  object: schemaObject,
  enum: schemaEnum,
  objectId(): z.ZodType<ObjectId> {
    return z.instanceof(ObjectId);
  },
  userId(): z.ZodType<ObjectId> {
    return z.instanceof(ObjectId);
  },
  ref(collection: string): z.ZodType<ObjectId> {
    return z.instanceof(ObjectId);
  },
};
