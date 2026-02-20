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
} from 'mongodb';

import { ModelSchema, InferDocumentType } from './types';
import { serializeModelSchema } from './schemaSerializer';

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

type IndexConflictDeduplicator = (store: {
  deduplicateByFields(params: { fields: string[]; sortBy: Document }): Promise<number>;
}) => Promise<number> | number;

type DuplicateGroup<TId> = {
  _id: unknown;
  ids: TId[];
  count: number;
};

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

  readonly Doc!: this['_doc'];

  private name: string;
  private readonly schema: TSchema;
  private readonly methods?: TMethods;
  private readonly indexes: IndexDescription[];
  private readonly searchIndexes: SearchIndexDescription[];
  private readonly deduplicateIndexes?: IndexConflictDeduplicator;
  private collection?: Collection<this['_type']>;
  private client?: MongoClient;

  /**
   * Creates a new Store instance
   *
   * @param name - The collection name in MongoDB
   * @param options - Store configuration
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
      /** Optional deduplication callback for duplicate-key index creation failures */
      deduplicateIndexes?: IndexConflictDeduplicator;
    }
  ) {
    this.name = name;
    this.schema = options.schema;
    this.methods = options.methods;
    // Normalize all indexes to have _modelence_ prefix
    this.indexes = options.indexes.map(normalizeIndexName);
    this.searchIndexes = options.searchIndexes || [];
    this.deduplicateIndexes = options.deduplicateIndexes;
  }

  getName() {
    return this.name;
  }

  /** @internal */
  getSchema() {
    return this.schema;
  }

  /** @internal */
  getSerializedSchema() {
    return serializeModelSchema(this.schema);
  }

  /**
   * Extends the store with additional schema fields, indexes, methods, and search indexes.
   * Returns a new Store instance with the extended schema and updated types.
   * Methods from the original store are preserved with updated type signatures.
   *
   * @param config - Additional schema fields, indexes, methods, and search indexes to add
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
    TExtendedMethods extends Record<
      string,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this: WithId<InferDocumentType<TSchema & TExtendedSchema>> & any, ...args: any[]) => any
    > = Record<string, never>,
  >(config: {
    schema?: TExtendedSchema;
    indexes?: IndexDescription[];
    methods?: TExtendedMethods;
    searchIndexes?: SearchIndexDescription[];
    deduplicateIndexes?: IndexConflictDeduplicator;
  }): Store<
    TSchema & TExtendedSchema,
    PreserveMethodsForExtendedSchema<TMethods, TSchema & TExtendedSchema> & TExtendedMethods
  > {
    const extendedSchema = {
      ...this.schema,
      ...(config.schema || {}),
    } as TSchema & TExtendedSchema;

    const extendedIndexes = [...this.indexes, ...(config.indexes || [])];
    const extendedSearchIndexes = [...this.searchIndexes, ...(config.searchIndexes || [])];

    type CombinedMethods = PreserveMethodsForExtendedSchema<TMethods, TSchema & TExtendedSchema> &
      TExtendedMethods;

    const combinedMethods = {
      ...(this.methods || {}),
      ...(config.methods || {}),
    } as CombinedMethods | undefined;

    const extendedStore = new Store<TSchema & TExtendedSchema, CombinedMethods>(this.name, {
      schema: extendedSchema,
      methods: combinedMethods as unknown as CombinedMethods | undefined,
      indexes: extendedIndexes,
      searchIndexes: extendedSearchIndexes,
      deduplicateIndexes: config.deduplicateIndexes || this.deduplicateIndexes,
    });

    if (this.client) {
      throw new Error(
        `Store.extend() must be called before startApp(). Store '${this.name}' has already been initialized and cannot be extended.`
      );
    }

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
  async createIndexes() {
    const collection = this.requireCollection();

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

    // Find all _modelence_ prefixed indexes that are not in the current schema
    const currentIndexNames = new Set(
      this.indexes.map((idx) => idx.name).filter((name): name is string => typeof name === 'string')
    );
    const orphanedIndexes = [...indexByName.values()].filter(
      (existingIdx) =>
        hasModelencePrefix(existingIdx.name) && !currentIndexNames.has(existingIdx.name)
    );

    // Drop orphaned indexes
    for (const orphanedIndex of orphanedIndexes) {
      await dropIndexIfNeeded(orphanedIndex.name);
    }

    // Reconcile code-defined indexes against the current DB metadata.
    // Code wins on conflicts; non-conflicting manual indexes are preserved.
    if (this.indexes.length > 0) {
      for (const index of this.indexes) {
        if (!index.name) {
          continue;
        }

        const existingByName = indexByName.get(index.name);
        if (existingByName && !isSameIndexDefinition(existingByName, index)) {
          await dropIndexIfNeeded(existingByName.name);
        }

        const keySignature = getIndexKeySignature(index.key);
        if (keySignature) {
          const existingNamesForKey = [...(indexNamesByKey.get(keySignature) || [])];
          for (const existingName of existingNamesForKey) {
            if (existingName !== index.name) {
              await dropIndexIfNeeded(existingName);
            }
          }
        }

        const alignedIndex = indexByName.get(index.name);
        const hasAlignedIndex = !!alignedIndex && isSameIndexDefinition(alignedIndex, index);

        if (!hasAlignedIndex) {
          await collection.createIndexes([index]);
          addIndexToLookup({
            name: index.name,
            key: index.key,
            ...getComparableIndexOptions(index),
          });
        }
      }
    }
    if (this.searchIndexes.length > 0) {
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
   * await store.findOne({ _id: new ObjectId('...') })
   * await store.findOne({ tags: { $in: ['typescript', 'mongodb'] } })
   * await store.findOne({ $or: [{ name: 'John' }, { name: 'Jane' }] })
   * await store.findOne({ 'emails.address': 'test@example.com' }) // dot notation
   *
   * // ❌ TypeScript error - 'id' is not in schema:
   * await store.findOne({ id: '123' })
   * ```
   */
  async findOne(query: TypedFilter<this['_type']>, options?: FindOptions) {
    const document = await this.requireCollection().findOne<this['_rawDoc']>(
      query as Filter<this['_type']>,
      options
    );
    return document ? this.wrapDocument(document) : null;
  }

  async requireOne(
    query: TypedFilter<this['_type']>,
    options?: FindOptions,
    errorHandler?: () => Error
  ): Promise<this['_doc']> {
    const result = await this.findOne(query, options);
    if (!result) {
      throw errorHandler ? errorHandler() : new Error(`Record not found in ${this.name}`);
    }
    return result;
  }

  private find(
    query: TypedFilter<this['_type']>,
    options?: { sort?: Document; limit?: number; skip?: number }
  ) {
    const cursor = this.requireCollection().find(query as Filter<this['_type']>);
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
   * @returns The document, or null if not found
   */
  async findById(id: string | ObjectId): Promise<this['_doc'] | null> {
    const idSelector = typeof id === 'string' ? { _id: new ObjectId(id) } : { _id: id };
    return await this.findOne(idSelector as TypedFilter<this['_type']>);
  }

  /**
   * Fetches a single document by its ID, or throws an error if not found
   *
   * @param id - The ID of the document to find
   * @param errorHandler - Optional error handler to return a custom error if the document is not found
   * @returns The document
   */
  async requireById(id: string | ObjectId, errorHandler?: () => Error): Promise<this['_doc']> {
    const result = await this.findById(id);
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
   * @param options - Options
   * @returns The documents
   */
  async fetch(
    query: TypedFilter<this['_type']>,
    options?: { sort?: Document; limit?: number; skip?: number }
  ): Promise<this['_doc'][]> {
    const cursor = this.find(query, options);
    return (await cursor.toArray()).map(this.wrapDocument.bind(this));
  }

  /**
   * Inserts a single document
   *
   * @param document - The document to insert
   * @returns The result of the insert operation
   */
  async insertOne(
    document: OptionalUnlessRequiredId<InferDocumentType<TSchema>>
  ): Promise<InsertOneResult> {
    return await this.requireCollection().insertOne(document);
  }

  /**
   * Inserts multiple documents
   *
   * @param documents - The documents to insert
   * @returns The result of the insert operation
   */
  async insertMany(
    documents: OptionalUnlessRequiredId<InferDocumentType<TSchema>>[]
  ): Promise<InsertManyResult> {
    return await this.requireCollection().insertMany(documents);
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
    update: UpdateFilter<this['_type']>
  ): Promise<UpdateResult> {
    return await this.requireCollection().updateOne(this.getSelector(selector), update);
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
    update: UpdateFilter<this['_type']>
  ): Promise<UpdateResult> {
    return await this.requireCollection().updateOne(this.getSelector(selector), update, {
      upsert: true,
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
    update: UpdateFilter<this['_type']>
  ): Promise<UpdateResult> {
    return await this.requireCollection().updateMany(selector as Filter<this['_type']>, update, {
      upsert: true,
    });
  }

  /**
   * Deletes a single document
   *
   * @param selector - The selector to find the document to delete
   * @returns The result of the delete operation
   */
  async deleteOne(selector: TypedFilter<this['_type']>): Promise<DeleteResult> {
    return await this.requireCollection().deleteOne(selector as Filter<this['_type']>);
  }

  /**
   * Deletes multiple documents
   *
   * @param selector - The selector to find the documents to delete
   * @returns The result of the delete operation
   */
  async deleteMany(selector: TypedFilter<this['_type']>): Promise<DeleteResult> {
    return await this.requireCollection().deleteMany(selector as Filter<this['_type']>);
  }

  /**
   * Deduplicates documents by one or more fields, keeping the first document after sorting.
   *
   * @param params.fields - Fields that define a duplicate group
   * @param params.sortBy - Sort order used before grouping; first document is kept
   * @returns Number of deleted duplicate documents
   */
  async deduplicateByFields({
    fields,
    sortBy,
  }: {
    fields: string[];
    sortBy: Document;
  }): Promise<number> {
    if (fields.length === 0) {
      throw new Error('deduplicateByFields requires at least one field');
    }

    const groupId =
      fields.length === 1
        ? `$${fields[0]}`
        : Object.fromEntries(fields.map((field) => [field, `$${field}`]));

    const duplicateGroups = await this.requireCollection()
      .aggregate<DuplicateGroup<this['_rawDoc']['_id']>>([
        { $sort: sortBy },
        { $group: { _id: groupId, ids: { $push: '$_id' }, count: { $sum: 1 } } },
        { $match: { count: { $gt: 1 } } },
      ])
      .toArray();

    const duplicateIds = duplicateGroups.flatMap((group) => group.ids.slice(1));
    if (duplicateIds.length === 0) {
      return 0;
    }

    const deleteResult = await this.requireCollection().deleteMany({
      _id: { $in: duplicateIds },
    } as Filter<this['_type']>);

    return deleteResult.deletedCount ?? 0;
  }

  /**
   * Runs store-specific deduplication logic for index conflict recovery if configured.
   *
   * @returns Number of deleted duplicate documents, or null if no deduplicator is configured
   */
  async deduplicateOnIndexConflict(): Promise<number | null> {
    if (!this.deduplicateIndexes) {
      return null;
    }

    return await this.deduplicateIndexes(this);
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
