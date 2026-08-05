import { ObjectId } from 'mongodb';
import { z, ZodArray, ZodNumber } from 'zod';
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

/**
 * Registry of Zod schema instances that have been marked as private via `.private()`.
 *
 * The WeakSet holds no strong references, so schemas are
 * garbage-collected normally when no longer in use.
 */
const privateSchemaRegistry = new WeakSet<z.ZodType>();

(z.ZodType.prototype as any).private = function (this: z.ZodType) {
  privateSchemaRegistry.add(this);
  return this;
};

export function isFieldPrivate(type: unknown): boolean {
  if (!type || typeof type !== 'object') return false;

  // Check the registry first — handles all Zod types uniformly.
  if (type instanceof z.ZodType && privateSchemaRegistry.has(type)) {
    return true;
  }

  // Unwrap transparent wrapper types so that `.private()` applied to the
  // inner schema is visible even when the field is declared as, e.g.,
  // `schema.string().private().optional()`.
  // Using public Zod API methods (.unwrap(), .removeDefault(), etc.) wherever
  // they exist, to avoid dependence on the unstable `_def` internal structure.
  if (type instanceof z.ZodOptional) return isFieldPrivate(type.unwrap());
  if (type instanceof z.ZodNullable) return isFieldPrivate(type.unwrap());
  if (type instanceof z.ZodDefault) return isFieldPrivate(type.removeDefault());
  if (type instanceof z.ZodBranded) return isFieldPrivate(type.unwrap());
  if (type instanceof z.ZodReadonly) return isFieldPrivate(type.unwrap());
  if (type instanceof z.ZodCatch) return isFieldPrivate(type.removeCatch());
  // ZodEffects (transform/refine/pipe) has no public unwrap — _def.schema is the only accessor.
  if (type instanceof z.ZodEffects) return isFieldPrivate((type._def as any).schema);
  return false;
}

export function extractPrivateFieldPaths(schemaDef: unknown, prefix = ''): string[] {
  if (!schemaDef || typeof schemaDef !== 'object') return [];

  const paths: string[] = [];

  if (isFieldPrivate(schemaDef)) {
    if (prefix && !paths.includes(prefix)) {
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
  } else if (schemaDef instanceof z.ZodOptional) {
    paths.push(...extractPrivateFieldPaths(schemaDef.unwrap(), prefix));
  } else if (schemaDef instanceof z.ZodNullable) {
    paths.push(...extractPrivateFieldPaths(schemaDef.unwrap(), prefix));
  } else if (schemaDef instanceof z.ZodDefault) {
    paths.push(...extractPrivateFieldPaths(schemaDef.removeDefault(), prefix));
  } else if (schemaDef instanceof z.ZodEffects) {
    // ZodEffects (transform/refine) has no public unwrap — _def.schema is the only accessor.
    paths.push(...extractPrivateFieldPaths((schemaDef._def as any).schema, prefix));
  } else if (schemaDef instanceof z.ZodUnion) {
    // Recurse into every branch; a private field inside any branch must be stripped.
    for (const option of schemaDef.options as z.ZodTypeAny[]) {
      paths.push(...extractPrivateFieldPaths(option, prefix));
    }
  } else if (schemaDef instanceof z.ZodBranded) {
    paths.push(...extractPrivateFieldPaths(schemaDef.unwrap(), prefix));
  } else if (schemaDef instanceof z.ZodReadonly) {
    paths.push(...extractPrivateFieldPaths(schemaDef.unwrap(), prefix));
  } else if (schemaDef instanceof z.ZodCatch) {
    paths.push(...extractPrivateFieldPaths(schemaDef.removeCatch(), prefix));
  } else if (Array.isArray(schemaDef)) {
    for (const item of schemaDef) {
      paths.push(...extractPrivateFieldPaths(item, prefix));
    }
  } else if (
    typeof schemaDef === 'object' &&
    schemaDef !== null &&
    !(schemaDef instanceof z.ZodType)
  ) {
    for (const key of Object.keys(schemaDef)) {
      const val = (schemaDef as any)[key];
      const fieldPath = prefix ? `${prefix}.${key}` : key;
      paths.push(...extractPrivateFieldPaths(val, fieldPath));
    }
  }

  return Array.from(new Set(paths));
}

/** Helper type to unwrap transparent Zod wrapper schemas (Default, Effects, Branded, Readonly, Catch, Union). */
type UnwrapTransparent<E> =
  E extends z.ZodDefault<infer Inner>
    ? Inner
    : E extends z.ZodEffects<infer Inner, any, any>
      ? Inner
      : E extends z.ZodBranded<infer Inner, any>
        ? Inner
        : E extends z.ZodReadonly<infer Inner>
          ? Inner
          : E extends z.ZodCatch<infer Inner>
            ? Inner
            : E extends z.ZodUnion<infer Options>
              ? Options[number]
              : never;

export type IsPrivateField<F> = F extends { readonly _isPrivateTag: true }
  ? true
  : F extends z.ZodOptional<infer Inner>
    ? IsPrivateField<Inner>
    : F extends z.ZodNullable<infer Inner>
      ? IsPrivateField<Inner>
      : [UnwrapTransparent<F>] extends [never]
        ? false
        : IsPrivateField<UnwrapTransparent<F>>;

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

type InferSelectedZodType<E, KKeys extends string> =
  E extends z.ZodOptional<infer Inner>
    ? InferSelectedZodType<Inner, KKeys> | undefined
    : E extends z.ZodNullable<infer Inner>
      ? InferSelectedZodType<Inner, KKeys> | null
      : E extends z.ZodObject<infer Shape, any, any>
        ? InferSelectedDocumentType<Shape, KKeys>
        : E extends z.ZodArray<infer InnerElement, any>
          ? Array<InferSelectedZodType<InnerElement, KKeys>>
          : E extends { _def: { typeName: 'ZodUnion'; options: infer Options } }
            ? Options extends Array<z.ZodTypeAny>
              ? InferSelectedZodType<Options[number], KKeys>
              : never
            : E extends z.ZodDefault<infer Inner>
              ? InferSelectedZodType<Inner, KKeys>
              : E extends z.ZodEffects<infer Inner, any, any>
                ? InferSelectedZodType<Inner, KKeys>
                : E extends z.ZodBranded<infer Inner, any>
                  ? InferSelectedZodType<Inner, KKeys>
                  : E extends z.ZodReadonly<infer Inner>
                    ? InferSelectedZodType<Inner, KKeys>
                    : E extends z.ZodCatch<infer Inner>
                      ? InferSelectedZodType<Inner, KKeys>
                      : E extends z.ZodTypeAny
                        ? z.infer<E>
                        : never;

type SubKeys<KKeys, Prefix> = KKeys extends string
  ? KKeys extends `${Extract<Prefix, string>}.${infer Rest}`
    ? Rest
    : never
  : never;

type IsSelectedKey<K, KKeys> = [KKeys] extends [never]
  ? false
  : K extends KKeys
    ? true
    : `${Extract<K, string>}.${string}` extends KKeys
      ? true
      : [Extract<KKeys, `${Extract<K, string>}.${string}` | K>] extends [never]
        ? false
        : true;

type IsFieldOptional<F> = F extends z.ZodOptional<z.ZodTypeAny> ? true : false;

type IsFieldVisible<F, K, KKeys> = IsPrivateField<F> extends true ? IsSelectedKey<K, KKeys> : true;

type InferFieldValue<F, KKeys, K> = F extends z.ZodTypeAny
  ? InferSelectedZodType<F, SubKeys<KKeys, K>>
  : F extends Array<infer ElementType extends SchemaTypeDefinition>
    ? Array<InferSelectedDocumentType<ElementType, SubKeys<KKeys, K>>>
    : F extends ObjectTypeDefinition
      ? InferSelectedDocumentType<F, SubKeys<KKeys, K>>
      : never;

/**
 * Represents the document when specific private fields are un-hidden using store.select(...).
 * Includes all public (non-private) fields plus any explicitly selected private fields.
 */
export type InferSelectedDocumentType<
  T extends SchemaTypeDefinition,
  KKeys extends string = never,
> = {
  [K in keyof T as IsFieldVisible<T[K], K, KKeys> extends true
    ? IsFieldOptional<T[K]> extends true
      ? K
      : never
    : never]?: InferFieldValue<T[K], KKeys, K>;
} & {
  [K in keyof T as IsFieldVisible<T[K], K, KKeys> extends true
    ? IsFieldOptional<T[K]> extends false
      ? K
      : never
    : never]: InferFieldValue<T[K], KKeys, K>;
};

/**
 * Represents the default fetched document when reading from the store (store.fetch(), store.findOne()).
 */
export type InferFetchedDocumentType<T extends SchemaTypeDefinition> = InferSelectedDocumentType<
  T,
  never
>;

export namespace schema {
  export type infer<T extends SchemaTypeDefinition> = InferDocumentType<T>;
  export type inferFetched<T extends SchemaTypeDefinition> = InferFetchedDocumentType<T>;
  export type inferSelected<
    T extends SchemaTypeDefinition,
    KKeys extends string,
  > = InferSelectedDocumentType<T, KKeys>;
}
