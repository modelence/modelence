import { isDeepStrictEqual } from 'node:util';

import {
  AggregateOptions,
  AggregationCursor,
  Collection,
  DeleteResult,
  Document,
  IndexDescription,
  InsertOneResult,
  MongoClient,
  UpdateResult,
  Filter,
  WithId,
  WithoutId,
  OptionalUnlessRequiredId,
  FindOptions,
  UpdateFilter,
  ObjectId,
  BulkWriteResult,
  AnyBulkWriteOperation,
  InsertManyResult,
  ClientSession,
  SearchIndexDescription,
  MongoError,
  FilterOperators,
  SortDirection,
  CollationOptions,
  FindOneAndUpdateOptions,
  FindOneAndDeleteOptions,
  FindOneAndReplaceOptions,
  ReplaceOptions,
  ChangeStream,
  ChangeStreamOptions,
  DistinctOptions,
} from 'mongodb';
import {
  ModelSchema,
  InferDocumentType,
  InferFetchedDocumentType,
  InferSelectedDocumentType,
  extractPrivateFieldPaths,
  extractPublicFieldPaths,
} from './types';
import { serializeModelSchema } from './schemaSerializer';
import { applyDefaultsToModelSchema } from './schemaDefaults';
import { isUniqueIndexViolation, formatUniqueIndexViolationReport } from './indexErrors';

/**
 * Result of {@link Store.findOneAndUpsert}: the post-op document plus whether
 * this call inserted it. Declared at module scope (not inline) so the `this`
 * polymorphic document type can be passed in as a type parameter — TS forbids
 * a `this` type inside an inline object-type literal in a return position.
 */
export type UpsertResult<TDoc> = {
  /** The document after the op; null only when `upsert: false` and nothing matched. */
  doc: TDoc | null;
  /** True exactly when this call inserted the document. */
  isNew: boolean;
};

/**
 * Helper type to extract string key selections for a schema.
 * Accepts any top-level key of TSchema or any dot-notation path starting with a top-level key of TSchema (e.g. 'groupInfo.users').
 */
export type SelectKey<TSchema extends ModelSchema> =
  | (keyof TSchema & string)
  | `${keyof TSchema & string}.${string}`;

//Determines whether the given projection object is an Inclusion projection or an Exclusion projection
type IsInclusionProjection<TProj> =
  TProj extends Record<string, unknown>
    ? [
        {
          [K in keyof TProj]: TProj[K] extends 1 | true ? true : never;
        }[keyof TProj],
      ] extends [never]
      ? false
      : true
    : false;

//Extracts only the keys that are explicitly included (assigned 1 or true)
type ExtractInclusionKeys<TProj> =
  TProj extends Record<string, unknown>
    ? {
        [K in keyof TProj & string]: TProj[K] extends 1 | true ? K : never;
      }[keyof TProj & string]
    : never;

//Extracts the keys that are explicitly excluded in an exclusion projection (e.g., { active: 0 })
type ExtractExclusionKeys<TProj> =
  TProj extends Record<string, unknown>
    ? {
        [K in keyof TProj & string]: string extends K ? never : K;
      }[keyof TProj & string]
    : never;

/**
 * ExtractProjectionUnHiddenKeys: Combines the rules above to calculate which private field paths should be un-hidden in the returned TypeScript document type
 * Logic Branching:
 * If {@link IsInclusionProjection<TProj>} is true: It calls {@link ExtractInclusionKeys}. Only fields explicitly included via 1 or true are un-hidden.
 * If {@link IsInclusionProjection<TProj>} is false (Exclusion Projection): It takes all private fields in {@link SelectKey} and removes (Exclude) any keys (or subpaths) that were explicitly set to 0 in {@link ExtractExclusionKeys}.
 * Example: If projection: { active: 0 } is passed, active is excluded, so all private fields (apiKey, teamSettings.memberEmails) are un-hidden.
 * Example: If projection: { apiKey: 0 } is passed, apiKey is excluded, so apiKey remains hidden while teamSettings.memberEmails is un-hidden.
 */
type ExtractProjectionUnHiddenKeys<TSchema extends ModelSchema, TProj> =
  IsInclusionProjection<TProj> extends true
    ? ExtractInclusionKeys<TProj>
    : Exclude<
        SelectKey<TSchema>,
        ExtractExclusionKeys<TProj> | `${Extract<ExtractExclusionKeys<TProj>, string>}.${string}`
      >;

/**
 * Reusable type helper representing the document returned by store read operations.
 * Defaults to excluding private fields unless `KSelect` explicitly selects them or `KProjection` includes them / omits them from exclusion.
 */
export type FetchedDoc<
  TSchema extends ModelSchema,
  TMethods = Record<string, never>,
  KSelect extends SelectKey<TSchema> = never,
  KProjection = undefined,
> = WithId<
  [KProjection] extends [undefined]
    ? [KSelect] extends [never]
      ? InferFetchedDocumentType<TSchema>
      : InferSelectedDocumentType<TSchema, KSelect>
    : InferSelectedDocumentType<
        TSchema,
        KSelect | ExtractProjectionUnHiddenKeys<TSchema, KProjection>
      >
> &
  TMethods;

/**
 * Options for MongoDB `find` operations with support for un-hiding private fields via `select` or `projection`.
 */
export type FindOptionsWithSelect<
  TSchema extends ModelSchema,
  KSelect extends SelectKey<TSchema> = never,
  KProjection = undefined,
> = FindOptions & {
  select?: KSelect[];
  projection?: KProjection &
    TypedProjection<InferDocumentType<TSchema>> & {
      [K in keyof KProjection]: K extends
        | keyof WithId<InferDocumentType<TSchema>>
        | `${string}.${string}`
        ? KProjection[K]
        : never;
    };
};

/**
 * Options for Store `fetch` operations with support for un-hiding private fields via `select` or `projection`.
 */
export type FetchOptionsWithSelect<
  TSchema extends ModelSchema,
  TDoc = InferDocumentType<TSchema>,
  KSelect extends SelectKey<TSchema> = never,
  KProjection = undefined,
> = FetchOptions<TDoc> & {
  select?: KSelect[];
  projection?: KProjection &
    TypedProjection<TDoc> & {
      [K in keyof KProjection]: K extends keyof WithId<TDoc> | `${string}.${string}`
        ? KProjection[K]
        : never;
    };
};

/**
 * Top-level query operators (logical and evaluation) - custom version without Document index signature
 * Based on MongoDB's RootFilterOperators but without the [key: string]: any from Document
 * @internal
 */
type StrictRootFilterOperators<TSchema> = {
  $and?: TypedFilter<TSchema>[];
  $or?: TypedFilter<TSchema>[];
  $nor?: TypedFilter<TSchema>[];
  $not?: TypedFilter<TSchema>;
  $text?: {
    $search: string;
    $language?: string;
    $caseSensitive?: boolean;
    $diacriticSensitive?: boolean;
  };

  $where?: string | ((this: TSchema) => boolean);
  $comment?: string | Document;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  $expr?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  $jsonSchema?: any;
};

/**
 * Helper type to extract array element type
 * @internal
 */
type ArrayElement<T> = T extends (infer E)[] ? E : never;
type Flatten<T> = T extends ReadonlyArray<infer E> ? E : T;

/**
 * Helper type for $in/$nin that accepts any array/tuple where elements are assignable to T
 * This solves the issue where TypeScript infers ['a', 'b'] as a tuple instead of ('a' | 'b')[]
 * and where Array<Union> gets distributed into Union1[] | Union2[] | ...
 * We wrap the Exclude in a tuple check to prevent distribution
 * @internal
 */
type NonUndefined<T> = T extends undefined ? never : T;
type ArrayLikeOfUnion<T> = [NonUndefined<T>] extends [never]
  ? never
  : ReadonlyArray<NonUndefined<T>> | Array<NonUndefined<T>>;

/**
 * Enhanced FilterOperators that fixes $in and $nin to properly accept arrays of union types
 * MongoDB's native FilterOperators has issues with union types in $in/$nin arrays
 * because TypeScript distributes Array<Union> into Array1 | Array2 | ...
 * @internal
 */
type EnhancedFilterOperators<T> = Omit<FilterOperators<T>, '$in' | '$nin'> & {
  $in?: ArrayLikeOfUnion<T>;
  $nin?: ArrayLikeOfUnion<T>;
};

type ExistingIndex = Document & {
  key?: Document;
  name?: string;
};

type TypedFieldSelection<T, TValue> = {
  [K in keyof WithId<T> & string]?: TValue;
} & {
  [key: `${string}.${string}`]: TValue;
};

type ProjectionValue =
  | 0
  | 1
  | boolean
  | { $meta: string }
  | { $slice: number | [number, number] }
  | { $elemMatch: Document };

type TypedSort<T> = TypedFieldSelection<T, SortDirection>;
type TypedProjection<T> = TypedFieldSelection<T, ProjectionValue>;

type FetchOptions<T> = {
  sort?: TypedSort<T>;
  limit?: number;
  skip?: number;
  projection?: TypedProjection<T>;
};

export type IndexCreationMode = 'blocking' | 'background';
export type IndexReconcileMode = 'full' | 'drop-only' | 'create-only';

const COMPARABLE_INDEX_OPTION_FIELDS = [
  'background',
  'bits',
  'bucketSize',
  'collation',
  'default_language',
  'expireAfterSeconds',
  'hidden',
  'language_override',
  'max',
  'min',
  'partialFilterExpression',
  'sparse',
  'storageEngine',
  'textIndexVersion',
  'unique',
  'weights',
  'wildcardProjection',
  '2dsphereIndexVersion',
] as const;

const isDocumentRecord = (value: unknown): value is Document =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasModelencePrefix = (name: string): boolean => name.startsWith('_modelence_');

const getComparableIndexOptions = (index: ExistingIndex | IndexDescription): Document => {
  const options: Document = {};

  for (const field of COMPARABLE_INDEX_OPTION_FIELDS) {
    const value = (index as Document)[field];
    if (value !== undefined) {
      options[field] = value;
    }
  }

  return options;
};

/**
 * MongoDB index key order is significant (e.g. { a: 1, b: 1 } !== { b: 1, a: 1 }).
 */
const isSameIndexKey = (left: unknown, right: unknown): boolean => {
  if (!isDocumentRecord(left) || !isDocumentRecord(right)) {
    return false;
  }

  const leftEntries = Object.entries(left);
  const rightEntries = Object.entries(right);

  if (leftEntries.length !== rightEntries.length) {
    return false;
  }

  return leftEntries.every(([leftField, leftDirection], index) => {
    const [rightField, rightDirection] = rightEntries[index] || [];
    return leftField === rightField && isDeepStrictEqual(leftDirection, rightDirection);
  });
};

const isSameIndexDefinition = (existing: ExistingIndex, desired: IndexDescription): boolean => {
  if (!isSameIndexKey(existing.key, desired.key)) {
    return false;
  }

  return isDeepStrictEqual(getComparableIndexOptions(existing), getComparableIndexOptions(desired));
};

const getIndexKeySignature = (key: unknown): string | null => {
  if (!isDocumentRecord(key)) {
    return null;
  }

  return Object.entries(key)
    .map(([field, direction]) => `${field}:${JSON.stringify(direction)}`)
    .join('|');
};

/**
 * Lists all indexes in a collection, returning an empty array if collection doesn't exist
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const listIndexes = async (collection: Collection<any>): Promise<Document[]> => {
  try {
    return await collection.listIndexes().toArray();
  } catch (error) {
    // If collection doesn't exist yet, return empty array
    // It will be created when we insert data or create indexes
    if (error instanceof MongoError && error.code === 26) {
      return [];
    }
    throw error;
  }
};

/**
 * Generates an auto-generated index name from the index keys
 * Mimics MongoDB's default naming: field1_direction1_field2_direction2
 */
const generateAutoIndexName = (key: Document): string => {
  return Object.entries(key)
    .map(([field, direction]) => `${field}_${direction}`)
    .join('_');
};

/**
 * Normalizes an index by ensuring it has a name with _modelence_ prefix
 */
const normalizeIndexName = (index: IndexDescription): IndexDescription => {
  if (index.name) {
    // If name is provided, add _modelence_ prefix if not already present
    const name = index.name.startsWith('_modelence_') ? index.name : `_modelence_${index.name}`;
    return { ...index, name };
  }

  // Auto-generate name with _modelence_ prefix
  const autoName = generateAutoIndexName(index.key);
  return { ...index, name: `_modelence_${autoName}` };
};

/**
 * Custom filter value type that handles array fields specially:
 * - For array fields: allows element type, full array type, or FilterOperators
 * - For non-array fields: allows exact type or FilterOperators
 * We use [T] to prevent distribution when T is a union type
 * @internal
 */
type FilterValue<T> = [T] extends [unknown[]]
  ? ArrayElement<T> | T | EnhancedFilterOperators<T>
  : [T] extends [never]
    ? never
    : T | EnhancedFilterOperators<[T] extends [never] ? never : T>;

/**
 * Type-safe MongoDB filter that ensures only schema fields can be queried
 * while supporting all MongoDB query operators and dot notation for nested fields.
 *
 * This type combines:
 * - MongoDB's native `FilterOperators<T>` for field-level operators (comprehensive operator support)
 * - Custom `StrictRootFilterOperators<T>` for top-level operators without index signature
 * - Custom array field handling: allows passing single element when field is an array
 * - Custom restriction: only strings containing dots are allowed for nested field queries
 *
 * @example
 * ```ts
 * const dbUsers = new Store('users', {
 *   schema: {
 *     name: schema.string(),
 *     age: schema.number(),
 *     tags: schema.array(schema.string()),
 *     collections: schema.array(schema.string()),
 *     address: schema.object({
 *       street: schema.string(),
 *       city: schema.string(),
 *     }),
 *   },
 *   indexes: []
 * });
 *
 * // ✅ Valid - field exists in schema
 * await dbUsers.findOne({ name: 'John' });
 *
 * // ✅ Valid - using MongoDB operators (from FilterOperators)
 * await dbUsers.findOne({ age: { $gt: 18 } });
 * await dbUsers.findOne({ tags: { $in: ['typescript', 'mongodb'] } });
 * await dbUsers.findOne({ $or: [{ name: 'John' }, { name: 'Jane' }] });
 *
 * // ✅ Valid - array field with single element (checks if array contains the element)
 * await dbUsers.findOne({ collections: 'users' });
 *
 * // ✅ Valid - dot notation for nested fields (must contain a dot)
 * await dbUsers.findOne({ 'address.city': 'New York' });
 * await dbUsers.findOne({ 'emails.0.address': 'test@example.com' });
 *
 * // ❌ TypeScript error - 'id' is not in schema and doesn't contain a dot
 * await dbUsers.findOne({ id: '123' });
 * ```
 */
export type TypedFilter<T> = {
  [K in keyof WithId<T>]?: FilterValue<WithId<T>[K]>;
} & StrictRootFilterOperators<T> & {
    // Support for MongoDB dot notation (e.g., 'emails.address', 'profile.settings.theme')
    // Only strings containing dots are allowed, which provides better type safety
    // while still enabling MongoDB's nested field query syntax
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [K: `${string}.${string}`]: any;
  };

/**
 * Helper type to preserve method types when extending a store.
 * Maps each method to work with the extended schema while preserving signatures.
 * @internal
 */
type PreserveMethodsForExtendedSchema<
  TBaseMethods extends Record<string, (...args: never[]) => unknown>,
  TExtendedSchema extends ModelSchema,
> = {
  [K in keyof TBaseMethods]: TBaseMethods[K] extends (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this: any,
    ...args: infer Args
  ) => infer Return
    ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this: WithId<InferDocumentType<TExtendedSchema>> & any, ...args: Args) => Return
    : never;
};

/**
 * Type-erased Store reference for chain traversal.
 * Chain members carry different TSchema/TMethods, so the generic
 * parameters must be erased. This alias contains the `any` in one place.
 * @internal
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyStore = Store<any, any>;

/**
 * The Store class provides a type-safe interface for MongoDB collections with built-in schema validation and helper methods.
 *
 * @category Store
 * @typeParam TSchema - The document schema type
 * @typeParam TMethods - Custom methods that will be added to documents
 *
 * @example
 * ```ts
 * const dbTodos = new Store('todos', {
 *   schema: {
 *     title: schema.string(),
 *     completed: schema.boolean(),
 *     dueDate: schema.date().optional(),
 *     userId: schema.userId(),
 *   },
 *   methods: {
 *     isOverdue() {
 *       return this.dueDate < new Date();
 *     }
 *   }
 * });
 * ```
 */
export class Store<
  TSchema extends ModelSchema,
  TMethods extends Record<
    string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this: WithId<InferDocumentType<TSchema>> & TMethods, ...args: any[]) => any
  >,
> {
  /** @internal */
  readonly _type!: InferDocumentType<TSchema>;
  /** @internal */
  readonly _rawDoc!: WithId<this['_type']>;
  /** @internal */
  readonly _doc!: this['_rawDoc'] & TMethods;

  /** @internal */
  readonly _fetchedType!: InferFetchedDocumentType<TSchema>;
  /** @internal */
  readonly _fetchedRawDoc!: WithId<this['_fetchedType']>;
  /** @internal */
  readonly _fetchedDoc!: this['_fetchedRawDoc'] & TMethods;

  readonly Doc!: this['_doc'];
  readonly FetchedDoc!: this['_fetchedDoc'];

  private name: string;
  private readonly schema: TSchema;
  private readonly methods?: TMethods;
  private readonly indexes: IndexDescription[];
  private readonly searchIndexes: SearchIndexDescription[];
  private readonly indexCreationMode: IndexCreationMode;
  private readonly privateFields: string[];
  private readonly publicFields: string[];
  private collection?: Collection<this['_type']>;
  private client?: MongoClient;

  // Chain tracking for linear extension model
  private _chainParent: AnyStore | null = null;
  private _chainChild: AnyStore | null = null;

  /**
   * Creates a new Store instance
   *
   * @param name - The collection name in MongoDB
   * @param options - Store configuration (schema, indexes, methods, search indexes, and optional index creation mode)
   */
  constructor(
    name: string,
    options: {
      /** Document schema using Modelence schema types */
      schema: TSchema;
      /** Custom methods to add to documents */
      methods?: TMethods;
      /** MongoDB indexes to create */
      indexes: IndexDescription[];
      /** MongoDB Atlas Search */
      searchIndexes?: SearchIndexDescription[];
      /** Whether index creation should block startup or run in background (default: 'background') */
      indexCreationMode?: IndexCreationMode;
    }
  ) {
    this.name = name;
    this.schema = options.schema;
    this.methods = options.methods;
    // Normalize all indexes to have _modelence_ prefix
    this.indexes = options.indexes.map(normalizeIndexName);
    this.searchIndexes = options.searchIndexes || [];
    this.indexCreationMode = options.indexCreationMode ?? 'background';
    this.privateFields = extractPrivateFieldPaths(options.schema);
    this.publicFields = extractPublicFieldPaths(options.schema);
  }

  getName() {
    return this.name;
  }

  getIndexCreationMode() {
    return this.indexCreationMode;
  }

  /** @internal */
  getSchema() {
    return this.schema;
  }

  /** @internal */
  getSerializedSchema() {
    return serializeModelSchema(this.schema);
  }

  /** @internal – normalized indexes (already have _modelence_ prefix) */
  getIndexes(): IndexDescription[] {
    return this.indexes;
  }

  /** @internal */
  getSearchIndexes(): SearchIndexDescription[] {
    return this.searchIndexes;
  }

  /** @internal – follows the chain to the latest extension */
  getChainTail(): AnyStore {
    let current: AnyStore = this;
    while (current._chainChild) {
      current = current._chainChild;
    }
    return current;
  }

  /** @internal – follows the chain back to the original store */
  getChainRoot(): AnyStore {
    let current: AnyStore = this;
    while (current._chainParent) {
      current = current._chainParent;
    }
    return current;
  }

  /**
   * Extends the store with additional schema fields, indexes, methods, and search indexes.
   * Returns a new Store instance with the extended schema and updated types.
   * Methods from the original store are preserved with updated type signatures.
   *
   * @param config - Additional schema fields, indexes, methods, search indexes, and optional index creation mode to add
   * @returns A new Store instance with the extended schema
   *
   * @example
   * ```ts
   * // Extend the users collection
   * export const dbUsers = baseUsersCollection.extend({
   *   schema: {
   *     firstName: schema.string(),
   *     lastName: schema.string(),
   *     companyId: schema.objectId().optional(),
   *   },
   *   indexes: [
   *     { key: { companyId: 1 } },
   *     { key: { lastName: 1, firstName: 1 } },
   *   ],
   *   methods: {
   *     getFullName() {
   *       return `${this.firstName} ${this.lastName}`;
   *     }
   *   }
   * });
   *
   * // Now fully typed with new fields
   * const user = await dbUsers.findOne({ firstName: 'John' });
   * console.log(user?.getFullName());
   * ```
   */
  extend<
    TExtendedSchema extends ModelSchema,
    TExtendedMethods extends Record<string, Function> = Record<string, never>,
  >(config: {
    schema?: TExtendedSchema;
    indexes?: IndexDescription[];
    methods?: TExtendedMethods;
    searchIndexes?: SearchIndexDescription[];
    /** Whether index creation should block startup or run in background */
    indexCreationMode?: IndexCreationMode;
  }): Store<
    TSchema & TExtendedSchema,
    PreserveMethodsForExtendedSchema<TMethods, TSchema & TExtendedSchema> & TExtendedMethods
  > {
    // Follow chain to the tail – extending always appends to the end
    const tail: AnyStore = this.getChainTail();

    if (this.client || tail.client) {
      throw new Error(
        `Store.extend() must be called before startApp(). Store '${this.name}' has already been initialized and cannot be extended.`
      );
    }

    type ExtendedSchema = TSchema & TExtendedSchema;

    const extendedSchema = {
      ...tail.schema,
      ...(config.schema || {}),
    } as ExtendedSchema;

    const extendedIndexes = [...tail.indexes, ...(config.indexes || [])];
    const extendedSearchIndexes = [...tail.searchIndexes, ...(config.searchIndexes || [])];

    type CombinedMethods = PreserveMethodsForExtendedSchema<TMethods, ExtendedSchema> &
      TExtendedMethods;

    const combinedMethods = {
      ...(tail.methods || {}),
      ...(config.methods || {}),
    } as CombinedMethods | undefined;

    const extendedStore = new Store<ExtendedSchema, CombinedMethods>(this.name, {
      schema: extendedSchema,
      methods: combinedMethods as unknown as CombinedMethods | undefined,
      indexes: extendedIndexes,
      searchIndexes: extendedSearchIndexes,
      indexCreationMode: config.indexCreationMode ?? tail.indexCreationMode,
    });

    // Link into the chain
    tail._chainChild = extendedStore;
    extendedStore._chainParent = tail;

    return extendedStore;
  }

  /** @internal */
  init(client: MongoClient) {
    if (this.collection) {
      throw new Error(`Collection ${this.name} is already initialized`);
    }

    this.client = client;
    this.collection = this.client.db().collection<this['_type']>(this.name);
  }

  /** @internal */
  async createIndexes(mode: IndexReconcileMode = 'full') {
    const collection = this.requireCollection();
    const shouldDropIndexes = mode !== 'create-only';
    const shouldCreateIndexes = mode !== 'drop-only';

    // Get all existing indexes in the collection (returns [] if collection doesn't exist)
    const existingIndexes = await listIndexes(collection);
    const indexByName = new Map<string, ExistingIndex & { name: string }>();
    const indexNamesByKey = new Map<string, Set<string>>();
    const droppedIndexNames = new Set<string>();

    const addIndexToLookup = (existingIndex: ExistingIndex & { name: string }) => {
      indexByName.set(existingIndex.name, existingIndex);

      const keySignature = getIndexKeySignature(existingIndex.key);
      if (!keySignature) {
        return;
      }

      const names = indexNamesByKey.get(keySignature);
      if (names) {
        names.add(existingIndex.name);
      } else {
        indexNamesByKey.set(keySignature, new Set([existingIndex.name]));
      }
    };

    const removeIndexFromLookup = (indexName: string) => {
      const existingIndex = indexByName.get(indexName);
      if (!existingIndex) {
        return;
      }

      indexByName.delete(indexName);

      const keySignature = getIndexKeySignature(existingIndex.key);
      if (!keySignature) {
        return;
      }

      const names = indexNamesByKey.get(keySignature);
      if (!names) {
        return;
      }

      names.delete(indexName);
      if (names.size === 0) {
        indexNamesByKey.delete(keySignature);
      }
    };

    for (const existingIndex of existingIndexes) {
      if (typeof existingIndex.name === 'string') {
        addIndexToLookup({
          ...existingIndex,
          name: existingIndex.name,
        });
      }
    }

    const dropIndexIfNeeded = async (indexName: string) => {
      if (indexName === '_id_' || droppedIndexNames.has(indexName)) {
        return;
      }
      try {
        await collection.dropIndex(indexName);
      } catch (error) {
        // Another concurrent reconciler may have already dropped it.
        if (!(error instanceof MongoError && error.code === 27)) {
          throw error;
        }
      }
      droppedIndexNames.add(indexName);
      removeIndexFromLookup(indexName);
    };

    if (shouldDropIndexes) {
      // Find all _modelence_ prefixed indexes that are not in the current schema
      const currentIndexNames = new Set(
        this.indexes
          .map((idx) => idx.name)
          .filter((name): name is string => typeof name === 'string')
      );
      const orphanedIndexes = [...indexByName.values()].filter(
        (existingIdx) =>
          hasModelencePrefix(existingIdx.name) && !currentIndexNames.has(existingIdx.name)
      );

      // Drop orphaned indexes
      for (const orphanedIndex of orphanedIndexes) {
        await dropIndexIfNeeded(orphanedIndex.name);
      }
    }

    // Reconcile code-defined indexes against the current DB metadata.
    // Code wins on conflicts; non-conflicting manual indexes are preserved.
    if (this.indexes.length > 0) {
      for (const index of this.indexes) {
        if (!index.name) {
          continue;
        }

        let requiresDropBeforeCreate = false;
        const existingByName = indexByName.get(index.name);
        if (existingByName && !isSameIndexDefinition(existingByName, index)) {
          if (shouldDropIndexes) {
            await dropIndexIfNeeded(existingByName.name);
          } else {
            requiresDropBeforeCreate = true;
          }
        }

        const keySignature = getIndexKeySignature(index.key);
        if (keySignature) {
          const existingNamesForKey = [...(indexNamesByKey.get(keySignature) || [])];
          for (const existingName of existingNamesForKey) {
            if (existingName !== index.name) {
              if (shouldDropIndexes) {
                await dropIndexIfNeeded(existingName);
              } else {
                requiresDropBeforeCreate = true;
              }
            }
          }
        }

        const alignedIndex = indexByName.get(index.name);
        const hasAlignedIndex = !!alignedIndex && isSameIndexDefinition(alignedIndex, index);

        if (!hasAlignedIndex && shouldCreateIndexes && !requiresDropBeforeCreate) {
          try {
            await collection.createIndexes([index]);
          } catch (error) {
            // A unique index failing on existing duplicates is silently dangerous
            // (the constraint stays unenforced), so log an actionable report an
            // operator or AI agent can resolve, then let the error propagate.
            if (index.unique && isUniqueIndexViolation(error)) {
              console.error(formatUniqueIndexViolationReport(this.name, index, error));
            }
            throw error;
          }
          addIndexToLookup({
            name: index.name,
            key: index.key,
            ...getComparableIndexOptions(index),
          });
        }
      }
    }
    if (shouldCreateIndexes && this.searchIndexes.length > 0) {
      for (const searchIndex of this.searchIndexes) {
        try {
          await collection.createSearchIndexes([searchIndex]);
        } catch (error) {
          if (error instanceof MongoError && error.code === 68 && searchIndex.name) {
            await collection.dropSearchIndex(searchIndex.name);
            await collection.createSearchIndexes([searchIndex]);
          } else {
            throw error;
          }
        }
      }
    }
  }

  private wrapDocument(document: this['_rawDoc']): this['_doc'] {
    if (!this.methods) {
      return document as unknown as this['_doc'];
    }

    const result = Object.create(
      null,
      Object.getOwnPropertyDescriptors({
        ...document,
        ...this.methods,
      })
    );

    return result as this['_doc'];
  }

  private wrapFetchedDocument<KSelect extends SelectKey<TSchema> = never, KProjection = undefined>(
    document: this['_rawDoc']
  ): FetchedDoc<TSchema, TMethods, KSelect, KProjection> {
    return this.wrapDocument(document) as unknown as FetchedDoc<
      TSchema,
      TMethods,
      KSelect,
      KProjection
    >;
  }

  /**
   * For convenience, to also allow directy passing a string or ObjectId as the selector
   */
  private getSelector(selector: TypedFilter<this['_type']> | string | ObjectId) {
    if (typeof selector === 'string') {
      return { _id: new ObjectId(selector) } as Filter<this['_type']>;
    }

    if (selector instanceof ObjectId) {
      return { _id: selector } as Filter<this['_type']>;
    }

    return selector as Filter<this['_type']>;
  }

  /** @internal */
  requireCollection() {
    if (!this.collection) {
      throw new Error(`Collection ${this.name} is not provisioned`);
    }

    return this.collection;
  }

  /** @internal */
  requireClient() {
    if (!this.client) {
      throw new Error(`Database is not connected`);
    }

    return this.client;
  }

  /**
   * Finds a single document matching the query
   *
   * @param query - Type-safe query filter. Only schema fields, MongoDB operators, and dot notation are allowed.
   * @param options - Find options
   * @returns The document, or null if not found
   *
   * @example
   * ```ts
   * // ✅ Valid queries:
   * await store.findOne({ name: 'John' })
   * await store.findOne({ age: { $gt: 18 } })
   * await store.findOne({ customerId: 25062006 },{ select: ['password'] })
   * await store.findOne({ _id: new ObjectId('...') })
   * await store.findOne({ tags: { $in: ['typescript', 'mongodb'] } })
   * await store.findOne({ $or: [{ name: 'John' }, { name: 'Jane' }] })
   * await store.findOne({ 'emails.address': 'test@example.com' }) // dot notation
   *
   * // ❌ TypeScript error - 'id' is not in schema:
   * await store.findOne({ id: '123' })
   * ```
   */
  /**
   * Constructs the MongoDB projection document for fetch/read operations based on
   * schema private fields, caller-provided `select` parameters, and `projection` options.
   *
   * High-Level Overview:
   * 1. If `options.projection` is passed: Handles caller-defined projections.
   *    - In Inclusion mode (e.g. `{ name: 1 }`): Ensures nested private fields under included parents
   *      are excluded by expanding the parent key into its public sub-fields (e.g. `'teamSettings.maxQuota': 1`),
   *      without violating MongoDB rules against mixing 1 and 0 in a single projection.
   *    - In Exclusion mode (e.g. `{ active: 0 }`): Merges the caller's exclusions with the default
   *      private field exclusions so private fields never leak through.
   *    - Merges any fields specified in `options.select`.
   *    - Sanitizes redundant sub-path inclusion keys to prevent MongoDB path collision errors.
   * 2. If `options.select` is passed (without explicit `projection`):
   *    - Constructs an exclusion projection (`{ field: 0 }`) for all private fields NOT in `select`.
   * 3. Default query (no `projection` or `select`):
   *    - Excludes all top-level private fields (`{ apiKey: 0, credentials: 0 }`) by default.
   */
  private getFetchProjection(options?: {
    projection?: TypedProjection<InferDocumentType<TSchema>> | Document;
    select?: SelectKey<TSchema>[];
  }): Document | undefined {
    // =========================================================================
    // CASE 1: Caller provided an explicit MongoDB projection parameter
    // =========================================================================
    if (options?.projection) {
      const proj: Document = { ...(options.projection as Document) };
      const values = Object.values(proj);
      const isInclusion = values.some((val) => val === 1 || val === true);

      // Step 1A: Merge `options.select` keys into the explicit projection
      if (options?.select && options.select.length > 0) {
        for (const key of options.select) {
          if (isInclusion) {
            // Inclusion Mode: Add selected keys as 1
            proj[key] = 1;
          } else {
            // Exclusion Mode: Remove selected keys from the exclusion object to un-hide them
            delete proj[key];
          }
        }
      }

      // Step 1B: Process Inclusion Projections
      if (isInclusion) {
        const selectedKeys = (options?.select || []) as string[];
        const expandedProj: Document = { ...proj };

        // Sub-Step B1: Parent Object Expansion
        // Problem: If projection includes a parent object (e.g. `teamSettings: 1`), MongoDB returns all
        // child fields, leaking unselected private fields (e.g. `teamSettings.memberEmails`).
        // Adding `teamSettings.memberEmails: 0` is invalid because MongoDB rejects mixing 1 and 0.
        // Solution: Expand `teamSettings: 1` into explicit inclusions of all PUBLIC sub-fields
        // (e.g. `'teamSettings.maxQuota': 1`), keeping the projection purely inclusion-based.
        for (const key of Object.keys(expandedProj)) {
          if (expandedProj[key] === 1 || expandedProj[key] === true) {
            const prefix = `${key}.`;
            const privateChildren = this.privateFields.filter(
              (f) => f.startsWith(prefix) && f !== key
            );

            if (privateChildren.length > 0) {
              const unselectedPrivateChildren = privateChildren.filter((pField) => {
                const isSelected =
                  selectedKeys.includes(pField) ||
                  selectedKeys.some((s) => s.startsWith(`${pField}.`));
                const isExplicitlyIncluded =
                  expandedProj[pField] === 1 || expandedProj[pField] === true;
                return !isSelected && !isExplicitlyIncluded;
              });

              // If parent has unselected private children, replace parent key with its public sub-fields
              if (unselectedPrivateChildren.length > 0) {
                delete expandedProj[key];
                const publicChildren = this.publicFields.filter(
                  (f) => f.startsWith(prefix) && f !== key
                );
                for (const pChild of publicChildren) {
                  expandedProj[pChild] = 1;
                }
              }
            }
          }
        }

        // Sub-Step B2: Path Collision Sanitization
        // MongoDB rejects queries that combine parent inclusion and child inclusion
        // (e.g. `{ credentials: 1, 'credentials.password': 1 }`).
        // If a parent key is included (`1`), delete redundant child inclusion keys.
        const clean: Document = { ...expandedProj };
        const keys = Object.keys(clean);
        for (const key of keys) {
          if (clean[key] === 1 || clean[key] === true) {
            const prefix = `${key}.`;
            for (const childKey of keys) {
              if (
                childKey.startsWith(prefix) &&
                childKey !== key &&
                (clean[childKey] === 1 || clean[childKey] === true)
              ) {
                delete clean[childKey];
              }
            }
          }
        }

        // Sub-Step B3: Empty Inclusion Protection
        // If all requested keys were private and unselected, `clean` becomes `{}`.
        // Returning `{}` to MongoDB causes it to return the full document with all fields.
        // Fallback to `{ _id: 1 }` so MongoDB returns an empty document containing only `_id`.
        if (Object.keys(clean).length === 0) {
          clean['_id'] = 1;
        }
        return clean;
      }

      // Step 1C: Process Exclusion Projections
      // Merge the caller's exclusion keys with the default private field exclusions.
      // This ensures that private fields are still hidden even when an exclusion projection is passed.
      // Fields in `options.select` are removed from the exclusion list (they were already deleted in Step 1A).
      const selectedKeys = (options?.select || []) as string[];
      const defaultExclusion = this.getTopLevelPrivateExclusion(selectedKeys);
      if (defaultExclusion) {
        Object.assign(proj, defaultExclusion);
      }
      return proj;
    }

    // =========================================================================
    // CASE 2: Caller passed `select` options (without explicit projection parameter)
    // =========================================================================
    if (options?.select && options.select.length > 0) {
      const selected = options.select as string[];
      return this.getTopLevelPrivateExclusion(selected) ?? undefined;
    }

    // =========================================================================
    // CASE 3: Default read query (no projection and no select options)
    // =========================================================================
    return this.getTopLevelPrivateExclusion([]) ?? undefined;
  }

  /**
   * Returns an exclusion projection document (`{ field: 0 }`) for top-level private fields
   * that are NOT in the `selectedFields` list. Returns `undefined` if no exclusions are needed.
   *
   * This is the single source of truth for "which private fields should be excluded by default."
   * Used by all three cases in `getFetchProjection` to avoid duplicating exclusion logic.
   *
   * @param selectedFields - Fields explicitly selected/un-hidden by the caller
   */
  private getTopLevelPrivateExclusion(selectedFields: string[]): Document | undefined {
    // Find private fields that were NOT selected by the caller
    const unselectedPrivateFields = this.privateFields.filter((field) => {
      if (selectedFields.includes(field)) return false;
      if (selectedFields.some((s) => s.startsWith(`${field}.`))) return false;
      return true;
    });

    // Filter out redundant child exclusion paths when the parent is already excluded.
    // e.g., if `credentials` is excluded, no need to also exclude `credentials.password`.
    const topLevel = unselectedPrivateFields.filter((field) => {
      const parts = field.split('.');
      for (let i = 1; i < parts.length; i++) {
        const parent = parts.slice(0, i).join('.');
        if (unselectedPrivateFields.includes(parent)) {
          return false;
        }
      }
      return true;
    });

    if (topLevel.length === 0) {
      return undefined;
    }

    const proj: Document = {};
    for (const field of topLevel) {
      proj[field] = 0;
    }
    return proj;
  }

  /**
   * Finds a single document matching the query
   *
   * @param query - Type-safe query filter. Only schema fields, MongoDB operators, and dot notation are allowed.
   * @param options - Find options, including optional `select` array to un-hide private fields {@link FindOptionsWithSelect}
   * @returns The document, or null if not found
   *
   * @example
   * ```ts
   * // ✅ Valid queries:
   * await store.findOne({ name: 'John' })
   * await store.findOne({ name: 'John' }, { select: ['password'] })
   * ```
   */
  async findOne<KSelect extends SelectKey<TSchema> = never, KProjection = undefined>(
    query: TypedFilter<this['_type']>,
    options?: FindOptionsWithSelect<TSchema, KSelect, KProjection>
  ): Promise<FetchedDoc<TSchema, TMethods, KSelect, KProjection> | null> {
    const projection = this.getFetchProjection(options);

    const document = await this.requireCollection().findOne<this['_rawDoc']>(
      query as Filter<this['_type']>,
      projection ? { ...options, projection } : options
    );
    return document ? this.wrapFetchedDocument<KSelect, KProjection>(document) : null;
  }

  async requireOne<KSelect extends SelectKey<TSchema> = never, KProjection = undefined>(
    query: TypedFilter<this['_type']>,
    options?: FindOptionsWithSelect<TSchema, KSelect, KProjection>,
    errorHandler?: () => Error
  ): Promise<FetchedDoc<TSchema, TMethods, KSelect, KProjection>> {
    const result = await this.findOne<KSelect, KProjection>(query, options);
    if (!result) {
      throw errorHandler ? errorHandler() : new Error(`Record not found in ${this.name}`);
    }
    return result;
  }

  private find(query: TypedFilter<this['_type']>, options?: FetchOptions<this['_type']>) {
    const projection = this.getFetchProjection(options);
    const cursor = this.requireCollection().find(
      query as Filter<this['_type']>,
      projection ? { projection } : undefined
    );
    if (options?.sort) {
      cursor.sort(options.sort);
    }
    if (options?.limit) {
      cursor.limit(options.limit);
    }
    if (options?.skip) {
      cursor.skip(options.skip);
    }
    return cursor;
  }

  /**
   * Fetches a single document by its ID
   *
   * @param id - The ID of the document to find
   * @param options - Optional find options with `select` array {@link FindOptionsWithSelect}
   * @returns The document, or null if not found
   */
  async findById<KSelect extends SelectKey<TSchema> = never, KProjection = undefined>(
    id: string | ObjectId,
    options?: FindOptionsWithSelect<TSchema, KSelect, KProjection>
  ): Promise<FetchedDoc<TSchema, TMethods, KSelect, KProjection> | null> {
    const idSelector = typeof id === 'string' ? { _id: new ObjectId(id) } : { _id: id };
    return await this.findOne<KSelect, KProjection>(
      idSelector as TypedFilter<this['_type']>,
      options
    );
  }

  /**
   * Fetches a single document by its ID, or throws an error if not found
   *
   * @param id - The ID of the document to find
   * @param options - Optional find options with `select` array
   * @param errorHandler - Optional error handler to return a custom error if the document is not found
   * @returns The document
   */
  async requireById<KSelect extends SelectKey<TSchema> = never, KProjection = undefined>(
    id: string | ObjectId,
    options?: FindOptionsWithSelect<TSchema, KSelect, KProjection>,
    errorHandler?: () => Error
  ): Promise<FetchedDoc<TSchema, TMethods, KSelect, KProjection>> {
    const result = await this.findById<KSelect, KProjection>(id, options);
    if (!result) {
      throw errorHandler
        ? errorHandler()
        : new Error(`Record with id ${id} not found in ${this.name}`);
    }
    return result;
  }

  /**
   * Counts the number of documents that match a query
   *
   * @param query - The query to filter documents
   * @returns The number of documents that match the query
   */
  countDocuments(query: TypedFilter<this['_type']>): Promise<number> {
    return this.requireCollection().countDocuments(query as Filter<this['_type']>);
  }

  /**
   * Fetches multiple documents, equivalent to Node.js MongoDB driver's `find` and `toArray` methods combined.
   *
   * @param query - The query to filter documents
   * @param options - Optional fetch options
   * @param options.projection - Fields to include or exclude in the result documents
   * @param options.sort - Sort order for matching documents
   * @param options.limit - Maximum number of documents to return
   * @param options.skip - Number of matching documents to skip
   * @returns The documents
   *
   * @example
   * ```ts
   * // Include only selected fields
   * const docs = await store.fetch(
   *   { userId: user.id },
   *   { projection: { framework: 1, title: 1 }, sort: { createdAt: -1 }, limit: 50 }
   * );
   *
   * // Exclude large fields when not needed
   * const chunks = await store.fetch(
   *   { documentId },
   *   { projection: { embedding: 0 } }
   * );
   * ```
   */
  async fetch<KSelect extends SelectKey<TSchema> = never, KProjection = undefined>(
    query: TypedFilter<this['_type']>,
    options?: FetchOptionsWithSelect<TSchema, this['_type'], KSelect, KProjection>
  ): Promise<FetchedDoc<TSchema, TMethods, KSelect, KProjection>[]> {
    const cursor = this.find(query, options);
    return (await cursor.toArray()).map((doc) =>
      this.wrapFetchedDocument<KSelect, KProjection>(doc)
    );
  }

  /**
   * Inserts a single document
   *
   * @param document - The document to insert
   * @returns The result of the insert operation
   */
  async insertOne(
    document: OptionalUnlessRequiredId<InferDocumentType<TSchema>>,
    options?: { session?: ClientSession }
  ): Promise<InsertOneResult> {
    return await this.requireCollection().insertOne(document, options);
  }

  /**
   * Inserts a single document and returns the inserted document with its generated `_id`
   * and any helper methods applied.
   *
   * Unlike {@link insertOne}, which only returns the insert result metadata, this method
   * returns the full inserted document — useful when you need to immediately use the
   * newly created record (e.g. returning it from an API handler).
   *
   * @param document - The document to insert
   * @returns The inserted document with `_id` populated and methods applied
   *
   * @example
   * ```ts
   * const todo = await dbTodos.create({ title: 'Buy milk', completed: false });
   * console.log(todo._id);    // ObjectId
   * console.log(todo.title);  // 'Buy milk'
   * ```
   */
  async create(
    document: OptionalUnlessRequiredId<InferDocumentType<TSchema>>,
    options?: { session?: ClientSession }
  ): Promise<this['_doc']> {
    const docWithId = applyDefaultsToModelSchema(this.schema, {
      _id: new ObjectId(),
      ...document,
    }) as OptionalUnlessRequiredId<InferDocumentType<TSchema>>;

    await this.requireCollection().insertOne(docWithId, options);

    return this.wrapDocument(docWithId as unknown as this['_rawDoc']);
  }

  /**
   * Inserts multiple documents
   *
   * @param documents - The documents to insert
   * @returns The result of the insert operation
   */
  async insertMany(
    documents: OptionalUnlessRequiredId<InferDocumentType<TSchema>>[],
    options?: { session?: ClientSession }
  ): Promise<InsertManyResult> {
    return await this.requireCollection().insertMany(documents, options);
  }

  /**
   * Updates a single document
   *
   * @param selector - The selector to find the document to update
   * @param update - The update to apply to the document
   * @returns The result of the update operation
   */
  async updateOne(
    selector: TypedFilter<this['_type']> | string | ObjectId,
    update: UpdateFilter<this['_type']>,
    options?: { session?: ClientSession; collation?: CollationOptions }
  ): Promise<UpdateResult> {
    return await this.requireCollection().updateOne(this.getSelector(selector), update, options);
  }

  /**
   * Updates a single document, or inserts it if it doesn't exist
   *
   * @param selector - The selector to find the document to update
   * @param update - The MongoDB modifier to apply to the document
   * @returns The result of the update operation
   */
  async upsertOne(
    selector: TypedFilter<this['_type']> | string | ObjectId,
    update: UpdateFilter<this['_type']>,
    options?: { session?: ClientSession }
  ): Promise<UpdateResult> {
    return await this.requireCollection().updateOne(this.getSelector(selector), update, {
      upsert: true,
      ...options,
    });
  }

  /**
   * Updates multiple documents
   *
   * @param selector - The selector to find the documents to update
   * @param update - The MongoDB modifier to apply to the documents
   * @returns The result of the update operation
   */
  async updateMany(
    selector: TypedFilter<this['_type']>,
    update: UpdateFilter<this['_type']>,
    options?: { session?: ClientSession }
  ): Promise<UpdateResult> {
    return await this.requireCollection().updateMany(
      selector as Filter<this['_type']>,
      update,
      options
    );
  }

  /**
   * Updates multiple documents, or inserts them if they don't exist
   *
   * @param selector - The selector to find the documents to update
   * @param update - The MongoDB modifier to apply to the documents
   * @returns The result of the update operation
   */
  async upsertMany(
    selector: TypedFilter<this['_type']>,
    update: UpdateFilter<this['_type']>,
    options?: { session?: ClientSession }
  ): Promise<UpdateResult> {
    return await this.requireCollection().updateMany(selector as Filter<this['_type']>, update, {
      upsert: true,
      ...options,
    });
  }

  /**
   * Deletes a single document
   *
   * @param selector - The selector to find the document to delete
   * @returns The result of the delete operation
   */
  async deleteOne(
    selector: TypedFilter<this['_type']> | string | ObjectId,
    options?: { session?: ClientSession }
  ): Promise<DeleteResult> {
    return await this.requireCollection().deleteOne(this.getSelector(selector), options);
  }

  /**
   * Deletes multiple documents
   *
   * @param selector - The selector to find the documents to delete
   * @returns The result of the delete operation
   */
  async deleteMany(
    selector: TypedFilter<this['_type']>,
    options?: { session?: ClientSession }
  ): Promise<DeleteResult> {
    return await this.requireCollection().deleteMany(selector as Filter<this['_type']>, options);
  }

  /**
   * Atomically finds a document and updates it, returning the document
   *
   * @param selector - The selector to find the document
   * @param update - The update to apply
   * @param options - Options including `returnDocument` ('before' or 'after'), `upsert`, `session`, etc.
   * @returns The document (before or after update, depending on options), or null if not found
   */
  async findOneAndUpdate(
    selector: TypedFilter<this['_type']> | string | ObjectId,
    update: UpdateFilter<this['_type']>,
    options?: Omit<FindOneAndUpdateOptions, 'includeResultMetadata'>
  ): Promise<this['_fetchedDoc'] | null> {
    const projection = this.getFetchProjection(options);
    const result = await this.requireCollection().findOneAndUpdate(
      this.getSelector(selector),
      update,
      projection ? { ...options, projection } : (options ?? {})
    );
    return result ? this.wrapFetchedDocument(result as this['_rawDoc']) : null;
  }

  /**
   * Atomic find-or-create: runs `findOneAndUpdate` with `upsert` and reports,
   * as `isNew`, whether the returned document was newly inserted.
   *
   * The plain {@link findOneAndUpdate} deliberately hides result metadata and
   * returns only the document, so it can't distinguish an insert from a match.
   * This method surfaces the driver's `lastErrorObject.upserted` flag as
   * `isNew`, so callers can branch on create-vs-match without a separate
   * pre-existence read that would race with concurrent upserts.
   *
   * `upsert` defaults to `true` but is overridable — pass `upsert: false` to
   * make this a pure find-and-report (unknown selector → `{ doc: null, isNew:
   * false }`). `returnDocument` is always `'after'` and cannot be overridden.
   *
   * @example
   * ```ts
   * const { doc, isNew } = await dbUsers.findOneAndUpsert(
   *   { email },
   *   { $setOnInsert: { email, createdAt: new Date() } }
   * );
   * if (isNew) onSignup(doc); else onLogin(doc);
   * ```
   *
   * @returns `{ doc, isNew }` — `doc` is null only when `upsert: false` and
   *   nothing matched; `isNew` is `true` exactly when this call inserted the doc.
   */
  async findOneAndUpsert(
    selector: TypedFilter<this['_type']> | string | ObjectId,
    update: UpdateFilter<this['_type']>,
    options?: Omit<FindOneAndUpdateOptions, 'includeResultMetadata' | 'returnDocument'>
  ): Promise<UpsertResult<this['_fetchedDoc']>> {
    const projection = this.getFetchProjection(options);
    const result = await this.requireCollection().findOneAndUpdate(
      this.getSelector(selector),
      update,
      {
        upsert: true,
        ...options,
        ...(projection ? { projection } : {}),
        // Always request the post-op doc and the metadata carrying `upserted`.
        returnDocument: 'after',
        includeResultMetadata: true,
      }
    );
    const doc = result.value ? this.wrapFetchedDocument(result.value as this['_rawDoc']) : null;
    return { doc, isNew: Boolean(result.lastErrorObject?.upserted) };
  }

  /**
   * Atomically finds a document and deletes it, returning the deleted document
   *
   * @param selector - The selector to find the document
   * @param options - Options including `session`, `projection`, etc.
   * @returns The deleted document, or null if not found
   */
  async findOneAndDelete(
    selector: TypedFilter<this['_type']> | string | ObjectId,
    options?: Omit<FindOneAndDeleteOptions, 'includeResultMetadata'>
  ): Promise<this['_fetchedDoc'] | null> {
    const projection = this.getFetchProjection(options);
    const result = await this.requireCollection().findOneAndDelete(
      this.getSelector(selector),
      projection ? { ...options, projection } : (options ?? {})
    );
    return result ? this.wrapFetchedDocument(result as this['_rawDoc']) : null;
  }

  /**
   * Atomically finds a document and replaces it, returning the document
   *
   * @param selector - The selector to find the document
   * @param replacement - The replacement document
   * @param options - Options including `returnDocument` ('before' or 'after'), `upsert`, `session`, etc.
   * @returns The document (before or after replacement, depending on options), or null if not found
   */
  async findOneAndReplace(
    selector: TypedFilter<this['_type']> | string | ObjectId,
    replacement: WithoutId<this['_type']>,
    options?: Omit<FindOneAndReplaceOptions, 'includeResultMetadata'>
  ): Promise<this['_fetchedDoc'] | null> {
    const projection = this.getFetchProjection(options);
    const result = await this.requireCollection().findOneAndReplace(
      this.getSelector(selector),
      replacement,
      projection ? { ...options, projection } : (options ?? {})
    );
    return result ? this.wrapFetchedDocument(result as this['_rawDoc']) : null;
  }

  /**
   * Replaces a single document
   *
   * @param selector - The selector to find the document to replace
   * @param replacement - The replacement document (must not contain update operators)
   * @param options - Options including `upsert`, `session`, etc.
   * @returns The result of the replace operation
   */
  async replaceOne(
    selector: TypedFilter<this['_type']> | string | ObjectId,
    replacement: WithoutId<this['_type']>,
    options?: ReplaceOptions
  ): Promise<UpdateResult> {
    return await this.requireCollection().replaceOne(
      this.getSelector(selector),
      replacement,
      options
    );
  }

  /**
   * Returns an array of distinct values for a field across the collection
   *
   * @param key - The field name (supports dot notation for nested fields)
   * @param filter - Optional filter to narrow the documents
   * @param options - Optional distinct options
   * @returns An array of distinct values
   */

  async distinct<K extends keyof this['_rawDoc'] & string>(
    key: K,
    filter?: TypedFilter<this['_type']>,
    options?: DistinctOptions
  ): Promise<Array<Flatten<this['_rawDoc'][K]>>> {
    const f = (filter ?? {}) as Filter<this['_type']>;
    return options !== undefined
      ? await this.requireCollection().distinct(key, f, options)
      : await this.requireCollection().distinct(key, f);
  }

  /**
   * Opens a change stream on the collection to watch for real-time changes
   *
   * @param pipeline - Optional aggregation pipeline to filter/transform change events
   * @param options - Optional change stream options
   * @returns A ChangeStream instance
   */
  watch(pipeline?: Document[], options?: ChangeStreamOptions): ChangeStream {
    return this.requireCollection().watch(pipeline, options);
  }

  /**
   * Aggregates documents using MongoDB's aggregation framework
   *
   * @param pipeline - The aggregation pipeline
   * @param options - Optional options
   * @returns The aggregation cursor
   */
  aggregate(pipeline: Document[], options?: AggregateOptions): AggregationCursor<Document> {
    return this.requireCollection().aggregate(pipeline, options);
  }

  /**
   * Performs a bulk write operation on the collection
   *
   * @param operations - The operations to perform
   * @returns The result of the bulk write operation
   */
  bulkWrite(operations: AnyBulkWriteOperation<this['_type']>[]): Promise<BulkWriteResult> {
    return this.requireCollection().bulkWrite(operations);
  }

  /**
   * Returns the raw MongoDB database instance for advanced operations
   * @returns The MongoDB database instance
   * @throws Error if the store is not provisioned
   */
  getDatabase() {
    return this.requireClient().db();
  }

  /**
   * Returns the raw MongoDB collection instance for advanced operations
   * @returns The MongoDB collection instance
   * @throws Error if the store is not provisioned
   */
  rawCollection() {
    return this.requireCollection();
  }

  /**
   * Renames an existing collection to this store's name, used for migrations
   * @param oldName - The previous name of the collection
   * @throws Error if the old collection doesn't exist or if this store's collection already exists
   */
  async renameFrom(oldName: string, options?: { session?: ClientSession }) {
    const db = this.getDatabase();

    if (!this.collection || !db) {
      throw new Error(`Store ${this.name} is not provisioned`);
    }

    const oldCollections = await db.listCollections({ name: oldName }).toArray();
    if (oldCollections.length === 0) {
      throw new Error(`Collection ${oldName} not found`);
    }

    const newCollections = await db.listCollections({ name: this.name }).toArray();
    if (newCollections.length > 0) {
      throw new Error(`Collection ${this.name} already exists`);
    }

    const existingCollection = db.collection<this['_type']>(oldName);

    await existingCollection.rename(this.name, options);
  }

  /**
   * Performs a vector similarity search using MongoDB Atlas Vector Search
   *
   * @param params - Vector search parameters
   * @param params.field - The field name containing the vector embeddings
   * @param params.embedding - The query vector to search for
   * @param params.numCandidates - Number of nearest neighbors to consider (default: 100)
   * @param params.limit - Maximum number of results to return (default: 10)
   * @param params.projection - Additional fields to include in the results
   * @param params.indexName - Name of index (default: field + VectorSearch)
   * @returns An aggregation cursor with search results and scores
   *
   * @example
   * ```ts
   * const results = await store.vectorSearch({
   *   field: 'embedding',
   *   embedding: [0.1, 0.2, 0.3, ...],
   *   numCandidates: 100,
   *   limit: 10,
   *   projection: { title: 1, description: 1 }
   * });
   * ```
   */
  async vectorSearch({
    field,
    embedding,
    numCandidates,
    limit,
    projection,
    indexName,
  }: {
    field: string;
    embedding: number[];
    numCandidates?: number;
    limit?: number;
    projection?: Document;
    indexName?: string;
  }) {
    return this.aggregate([
      {
        $vectorSearch: {
          index: indexName || field + 'VectorSearch',
          path: field,
          queryVector: embedding,
          numCandidates: numCandidates || 100,
          limit: limit || 10,
        },
      },
      {
        $project: {
          _id: 1,
          score: { $meta: 'vectorSearchScore' },
          ...projection,
        },
      },
    ]);
  }

  /**
   * Creates a MongoDB Atlas Vector Search index definition
   *
   * @param params - Vector index parameters
   * @param params.field - The field name to create the vector index on
   * @param params.dimensions - The number of dimensions in the vector embeddings
   * @param params.similarity - The similarity metric to use (default: 'cosine')
   * @param params.indexName - Name of index (default: field + VectorSearch)
   * @returns A search index description object
   *
   * @example
   * ```ts
   * const store = new Store('documents', {
   *   schema: {
   *     title: schema.string(),
   *     embedding: schema.array(schema.number()),
   *   },
   *   indexes: [],
   *   searchIndexes: [
   *     Store.vectorIndex({
   *       field: 'embedding',
   *       dimensions: 1536,
   *       similarity: 'cosine'
   *     })
   *   ]
   * });
   * ```
   */
  static vectorIndex({
    field,
    dimensions,
    similarity = 'cosine',
    indexName,
  }: {
    field: string;
    dimensions: number;
    similarity?: 'cosine' | 'euclidean' | 'dotProduct';
    indexName?: string;
  }) {
    return {
      type: 'vectorSearch',
      name: indexName || field + 'VectorSearch',
      definition: {
        fields: [
          {
            type: 'vector',
            path: field,
            numDimensions: dimensions,
            similarity,
          },
        ],
      },
    };
  }
}
