import { ObjectId } from 'mongodb';
import { z, ZodArray, ZodNumber, ZodRawShape } from 'zod';
import { Store } from './store';

type ObjectTypeDefinition = {
  [key: string]: SchemaTypeDefinition;
};

type SingularSchemaTypeDefinition = z.ZodTypeAny | ObjectTypeDefinition; // ReturnType<typeof schema[keyof typeof schema]>;

type SchemaTypeDefinition = SingularSchemaTypeDefinition | Array<SingularSchemaTypeDefinition>;

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

declare module 'zod' {
  interface ZodType {
    /**
     * Marks this field as private so it is not returned in fetched store data by default.
     */
    private(): this & { readonly _isPrivateTag: true };
  }
}

if (!(z.ZodType.prototype as any).private) {
  (z.ZodType.prototype as any).private = function (this: z.ZodType) {
    (this as any)._isPrivate = true;
    return this;
  };
}

export function isFieldPrivate(type: unknown): boolean {
  if (!type || typeof type !== 'object') return false;
  if ('_isPrivate' in type && (type as any)._isPrivate === true) {
    return true;
  }
  if (
    type instanceof z.ZodOptional ||
    type instanceof z.ZodNullable ||
    type instanceof z.ZodDefault
  ) {
    return isFieldPrivate((type._def as any).innerType);
  }
  if (type instanceof z.ZodEffects) {
    return isFieldPrivate((type._def as any).schema);
  }
  return false;
}

export function extractPrivateFieldPaths(schemaDef: unknown, prefix = ''): string[] {
  if (!schemaDef || typeof schemaDef !== 'object') return [];

  const paths: string[] = [];

  if (isFieldPrivate(schemaDef)) {
    if (prefix) {
      paths.push(prefix);
    }
  }

  if (schemaDef instanceof z.ZodObject) {
    const shape = schemaDef.shape;
    for (const key of Object.keys(shape)) {
      const fieldPath = prefix ? `${prefix}.${key}` : key;
      paths.push(...extractPrivateFieldPaths(shape[key], fieldPath));
    }
  } else if (schemaDef instanceof z.ZodArray) {
    paths.push(...extractPrivateFieldPaths(schemaDef.element, prefix));
  } else if (
    schemaDef instanceof z.ZodOptional ||
    schemaDef instanceof z.ZodNullable ||
    schemaDef instanceof z.ZodDefault
  ) {
    paths.push(...extractPrivateFieldPaths((schemaDef._def as any).innerType, prefix));
  } else if (schemaDef instanceof z.ZodEffects) {
    paths.push(...extractPrivateFieldPaths((schemaDef._def as any).schema, prefix));
  } else if (Array.isArray(schemaDef)) {
    for (const item of schemaDef) {
      paths.push(...extractPrivateFieldPaths(item, prefix));
    }
  } else if (typeof schemaDef === 'object' && schemaDef !== null) {
    for (const key of Object.keys(schemaDef)) {
      const val = (schemaDef as any)[key];
      const fieldPath = prefix ? `${prefix}.${key}` : key;
      paths.push(...extractPrivateFieldPaths(val, fieldPath));
    }
  }

  return paths;
}

function unwrapZodSchema(schemaDef: unknown): unknown {
  let current = schemaDef;
  while (current && typeof current === 'object') {
    if (
      current instanceof z.ZodOptional ||
      current instanceof z.ZodNullable ||
      current instanceof z.ZodDefault
    ) {
      current = (current._def as any).innerType;
    } else if (current instanceof z.ZodEffects) {
      current = (current._def as any).schema;
    } else {
      break;
    }
  }
  return current;
}

// ATULTODO: Currently we are using and relying on getFetchedProjection
// func to filter and get the data, can we do like after the data is fetched we use zod
// kind of to remove the private fields or apply the filter as expected, we already have public and private fields
// filtered out, and so we can do this

export function extractPublicFieldPaths(schemaDef: unknown, prefix = ''): string[] {
  if (!schemaDef || typeof schemaDef !== 'object') return [];

  const paths: string[] = [];
  const unwrapped = unwrapZodSchema(schemaDef);

  if (unwrapped instanceof z.ZodObject) {
    const shape = unwrapped.shape;
    for (const key of Object.keys(shape)) {
      const fieldPath = prefix ? `${prefix}.${key}` : key;
      const childDef = shape[key];
      const innerChild = unwrapZodSchema(childDef);

      if (isFieldPrivate(childDef) && !(innerChild instanceof z.ZodObject)) {
        continue;
      }
      const childPaths = extractPublicFieldPaths(childDef, fieldPath);
      if (childPaths.length > 0) {
        paths.push(...childPaths);
      } else if (!isFieldPrivate(childDef)) {
        paths.push(fieldPath);
      }
    }
  } else if (unwrapped instanceof z.ZodArray) {
    paths.push(...extractPublicFieldPaths(unwrapped.element, prefix));
  } else if (Array.isArray(schemaDef)) {
    for (const item of schemaDef) {
      paths.push(...extractPublicFieldPaths(item, prefix));
    }
  } else if (schemaDef instanceof z.ZodType) {
    if (prefix && !isFieldPrivate(schemaDef)) paths.push(prefix);
  } else if (typeof schemaDef === 'object' && schemaDef !== null) {
    for (const key of Object.keys(schemaDef)) {
      const val = (schemaDef as any)[key];
      const fieldPath = prefix ? `${prefix}.${key}` : key;
      const innerVal = unwrapZodSchema(val);
      if (isFieldPrivate(val) && !(innerVal instanceof z.ZodObject)) {
        continue;
      }
      const childPaths = extractPublicFieldPaths(val, fieldPath);
      if (childPaths.length > 0) {
        paths.push(...childPaths);
      } else if (!isFieldPrivate(val)) {
        paths.push(fieldPath);
      }
    }
  } else {
    if (prefix && !isFieldPrivate(schemaDef)) paths.push(prefix);
  }

  return paths;
}

export type IsPrivateField<F> = F extends { readonly _isPrivateTag: true }
  ? true
  : F extends z.ZodOptional<infer Inner>
    ? IsPrivateField<Inner>
    : F extends z.ZodNullable<infer Inner>
      ? IsPrivateField<Inner>
      : F extends z.ZodDefault<infer Inner>
        ? IsPrivateField<Inner>
        : false;

export const schema = {
  string: schemaString,
  number: schemaNumber,
  date: schemaDate,
  boolean: schemaBoolean,
  array: schemaArray,
  object: schemaObject,
  enum: schemaEnum,
  embedding(): ZodArray<ZodNumber> {
    return z.array(z.number());
  },
  objectId(): z.ZodType<ObjectId> {
    return z.instanceof(ObjectId).describe('ObjectId');
  },
  userId(): z.ZodType<ObjectId> {
    return z.instanceof(ObjectId).describe('UserId');
  },
  ref<T extends ModelSchema>(
    _collection: string | Store<T, InferDocumentType<T>>
  ): z.ZodType<ObjectId> {
    return z.instanceof(ObjectId).describe('Ref');
  },
  union: z.union.bind(z),
  infer<T extends SchemaTypeDefinition>(_schema: T): InferDocumentType<T> {
    return {} as InferDocumentType<T>;
  },
  inferFetched<T extends SchemaTypeDefinition>(_schema: T): InferFetchedDocumentType<T> {
    return {} as InferFetchedDocumentType<T>;
  },
} as const;

/**
 * Represents the full document in MongoDB, including all fields (public + private).
 */
export type InferDocumentType<T extends SchemaTypeDefinition> = {
  [K in keyof T as T[K] extends z.ZodOptional<z.ZodTypeAny> ? K : never]?: T[K] extends z.ZodType
    ? z.infer<T[K]>
    : never;
} & {
  [K in keyof T as T[K] extends z.ZodOptional<z.ZodTypeAny> ? never : K]: T[K] extends z.ZodType
    ? z.infer<T[K]>
    : T[K] extends Array<infer ElementType extends SchemaTypeDefinition>
      ? Array<InferDocumentType<ElementType>>
      : T[K] extends ObjectTypeDefinition
        ? InferDocumentType<T[K]>
        : never;
};

type InferFetchedZodElement<E> =
  E extends z.ZodObject<infer Shape extends ZodRawShape, any, any>
    ? InferFetchedDocumentType<Shape>
    : E extends z.ZodArray<infer InnerElement extends z.ZodTypeAny, any>
      ? Array<InferFetchedZodElement<InnerElement>>
      : E extends z.ZodTypeAny
        ? z.infer<E>
        : never;

type InferSelectedZodElement<E, KKeys extends string> =
  E extends z.ZodObject<infer Shape extends ZodRawShape, any, any>
    ? InferSelectedDocumentType<Shape, KKeys>
    : E extends z.ZodArray<infer InnerElement extends z.ZodTypeAny, any>
      ? Array<InferSelectedZodElement<InnerElement, KKeys>>
      : E extends z.ZodTypeAny
        ? z.infer<E>
        : never;

/**
 * Represents the default fetched document when reading from the store (store.fetch(), store.findOne()).
 */
export type InferFetchedDocumentType<T extends SchemaTypeDefinition> = {
  [K in keyof T as IsPrivateField<T[K]> extends true
    ? never
    : T[K] extends z.ZodOptional<z.ZodTypeAny>
      ? K
      : never]?: T[K] extends z.ZodObject<infer Shape extends ZodRawShape, any, any>
    ? InferFetchedDocumentType<Shape>
    : T[K] extends z.ZodArray<infer ElementType extends z.ZodTypeAny, any>
      ? Array<InferFetchedZodElement<ElementType>>
      : T[K] extends z.ZodTypeAny
        ? z.infer<T[K]>
        : never;
} & {
  [K in keyof T as IsPrivateField<T[K]> extends true
    ? never
    : T[K] extends z.ZodOptional<z.ZodTypeAny>
      ? never
      : K]: T[K] extends z.ZodObject<infer Shape extends ZodRawShape, any, any>
    ? InferFetchedDocumentType<Shape>
    : T[K] extends z.ZodArray<infer ElementType extends z.ZodTypeAny, any>
      ? Array<InferFetchedZodElement<ElementType>>
      : T[K] extends z.ZodTypeAny
        ? z.infer<T[K]>
        : T[K] extends Array<infer ElementType extends SchemaTypeDefinition>
          ? Array<InferFetchedDocumentType<ElementType>>
          : T[K] extends ObjectTypeDefinition
            ? InferFetchedDocumentType<T[K]>
            : never;
};

type SubKeys<KKeys, Prefix> = KKeys extends string
  ? KKeys extends `${Extract<Prefix, string>}.${infer Rest}`
    ? Rest
    : never
  : never;

type IsSelectedKey<K, KKeys> = K extends KKeys
  ? true
  : `${Extract<K, string>}.${string}` extends KKeys
    ? true
    : [Extract<KKeys, `${Extract<K, string>}.${string}` | K>] extends [never]
      ? false
      : true;

/**
 * Represents the document when specific private fields are un-hidden using store.select(...).
 * Includes all public (non-private) fields plus any explicitly selected private fields.
 */
export type InferSelectedDocumentType<
  T extends SchemaTypeDefinition,
  KKeys extends string = never,
> = {
  [K in keyof T as IsPrivateField<T[K]> extends true
    ? IsSelectedKey<K, KKeys> extends true
      ? T[K] extends z.ZodOptional<z.ZodTypeAny>
        ? K
        : never
      : never
    : T[K] extends z.ZodOptional<z.ZodTypeAny>
      ? K
      : never]?: T[K] extends z.ZodObject<infer Shape extends ZodRawShape, any, any>
    ? InferSelectedDocumentType<Shape, SubKeys<KKeys, K>>
    : T[K] extends z.ZodArray<infer ElementType extends z.ZodTypeAny, any>
      ? Array<InferSelectedZodElement<ElementType, SubKeys<KKeys, K>>>
      : T[K] extends z.ZodTypeAny
        ? z.infer<T[K]>
        : never;
} & {
  [K in keyof T as IsPrivateField<T[K]> extends true
    ? IsSelectedKey<K, KKeys> extends true
      ? T[K] extends z.ZodOptional<z.ZodTypeAny>
        ? never
        : K
      : never
    : T[K] extends z.ZodOptional<z.ZodTypeAny>
      ? never
      : K]: T[K] extends z.ZodObject<infer Shape extends ZodRawShape, any, any>
    ? InferSelectedDocumentType<Shape, SubKeys<KKeys, K>>
    : T[K] extends z.ZodArray<infer ElementType extends z.ZodTypeAny, any>
      ? Array<InferSelectedZodElement<ElementType, SubKeys<KKeys, K>>>
      : T[K] extends z.ZodTypeAny
        ? z.infer<T[K]>
        : T[K] extends Array<infer ElementType extends SchemaTypeDefinition>
          ? Array<InferSelectedDocumentType<ElementType, SubKeys<KKeys, K>>>
          : T[K] extends ObjectTypeDefinition
            ? InferSelectedDocumentType<T[K], SubKeys<KKeys, K>>
            : never;
};

export namespace schema {
  export type infer<T extends SchemaTypeDefinition> = InferDocumentType<T>;
  export type inferFetched<T extends SchemaTypeDefinition> = InferFetchedDocumentType<T>;
  export type inferSelected<
    T extends SchemaTypeDefinition,
    KKeys extends string,
  > = InferSelectedDocumentType<T, KKeys>;
}
