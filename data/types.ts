import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { Store } from './store';

type ObjectTypeDefinition = {
  [key: string]: SchemaTypeDefinition;
};

type SingularSchemaTypeDefinition = z.ZodType | ObjectTypeDefinition; // ReturnType<typeof schema[keyof typeof schema]>;

type SchemaTypeDefinition = SingularSchemaTypeDefinition | [SingularSchemaTypeDefinition];

export type ModelSchema = {
  [key: string]: SchemaTypeDefinition;
};

const schemaString: typeof z.string = z.string.bind(z);

const schemaNumber: typeof z.number = z.number.bind(z);

const schemaDate: typeof z.date = z.date.bind(z);

const schemaBoolean: typeof z.boolean = z.boolean.bind(z);

const schemaArray: typeof z.array = z.array.bind(z);

const schemaObject: typeof z.object = z.object.bind(z);

const schemaEnum: typeof z.enum = z.enum.bind(z);

export const schema = {
  string: schemaString,
  number: schemaNumber,
  date: schemaDate,
  boolean: schemaBoolean,
  array: schemaArray,
  object: schemaObject,
  enum: schemaEnum,
  objectId(): z.ZodType<ObjectId> {
    return z.instanceof(ObjectId);
  },
  userId(): z.ZodType<ObjectId> {
    return z.instanceof(ObjectId);
  },
  ref(collection: string | Store<any, any>): z.ZodType<ObjectId> {
    return z.instanceof(ObjectId);
  },
};

export type InferDocumentType<T extends SchemaTypeDefinition> = {
  [K in keyof T as T[K] extends z.ZodOptional<any> ? K : never]?: (T[K] extends z.ZodType ? z.infer<T[K]> : never);
} & {
  [K in keyof T as T[K] extends z.ZodOptional<any> ? never : K]:
    T[K] extends z.ZodType ? z.infer<T[K]> :
    T[K] extends Array<infer ElementType extends SchemaTypeDefinition> ? Array<InferDocumentType<ElementType>> :
    T[K] extends ObjectTypeDefinition ? InferDocumentType<T[K]> :
    never;
};
