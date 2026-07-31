import { beforeEach, describe, expect, test, vi } from 'vitest';
import {
  IndexDescription,
  MongoError,
  MongoServerError,
  ObjectId,
  SearchIndexDescription,
} from 'mongodb';

import { Store } from './store';
import { schema, type ModelSchema } from './types';

const baseSchema = {
  name: {},
} as ModelSchema;

function createStore(options?: {
  indexes?: IndexDescription[];
  searchIndexes?: SearchIndexDescription[];
  indexCreationMode?: 'blocking' | 'background';
}) {
  return new Store<ModelSchema, Record<string, never>>('testCollection', {
    schema: baseSchema,
    indexes: options?.indexes || [],
    searchIndexes: options?.searchIndexes,
    indexCreationMode: options?.indexCreationMode,
    methods: undefined,
  });
}

function assertFetchOptionTypeSafety() {
  const typedStore = new Store('typedStore', {
    schema: {
      name: schema.string(),
      score: schema.number(),
      nested: schema.object({
        level: schema.number(),
      }),
    },
    indexes: [],
    methods: undefined,
  });

  void typedStore.fetch(
    { name: 'john' },
    {
      sort: { name: 1, score: -1, 'nested.level': 1 },
      projection: { name: 1, score: 1, 'nested.level': 1 },
    }
  );

  // @ts-expect-error unknown top-level field should be rejected in sort
  void typedStore.fetch({ name: 'john' }, { sort: { unknownField: 1 } });
  // @ts-expect-error unknown top-level field should be rejected in projection
  void typedStore.fetch({ name: 'john' }, { projection: { unknownField: 1 } });
}
void assertFetchOptionTypeSafety;

function assertInclusionProjectionWidenedTypeSafety() {
  const store = new Store('projectionStore', {
    schema: {
      name: schema.string(),
      age: schema.number(),
      secret: schema.string().private(),
    },
    indexes: [],
    methods: undefined,
  });

  async function testWidenedProjection() {
    // When projection is passed with fresh literal or number type (e.g. { name: 1 })
    const doc = await store.findOne({ name: 'john' }, { projection: { name: 1 } });
    void doc?.name; // ✅ name must NOT be omitted or typed as undefined
    void doc?.age; // ✅ age preserved
  }
  void testWidenedProjection;

  async function testInclusionUnHidesPrivateField() {
    // Inclusion projection with secret: 1 un-hides secret
    const doc = await store.findOne({ name: 'john' }, { projection: { secret: 1 } });
    void doc?.secret; // ✅ secret is un-hidden by inclusion projection
  }
  void testInclusionUnHidesPrivateField;
}
void assertInclusionProjectionWidenedTypeSafety;

function assertFindOneAndUpdateTypeSafety() {
  const privateStore = new Store('privateStore', {
    schema: {
      title: schema.string(),
      secret: schema.string().private(),
    },
    indexes: [],
    methods: undefined,
  });

  // No options: returns FetchedDoc (public fields only by default)
  async function noOptions() {
    const doc = await privateStore.findOneAndUpdate({ title: 'x' }, { $set: { title: 'y' } });
    void doc?.title; // ✅ public field is accessible
  }
  void noOptions;

  // With select: ['secret']: secret becomes visible in the return type
  async function withSelect() {
    const doc = await privateStore.findOneAndUpdate(
      { title: 'x' },
      { $set: { title: 'y' } },
      { select: ['secret'] }
    );
    void doc?.secret; // ✅ no error — secret is un-hidden by select
    void doc?.title; // ✅ public field always present
  }
  void withSelect;

  // @ts-expect-error unknown projection field should be rejected
  void privateStore.findOneAndDelete({ title: 'x' }, { projection: { unknownField: 0 } });

  void privateStore.findOneAndReplace(
    { title: 'x' },
    { title: 'y', secret: 's' },
    // @ts-expect-error unknown projection field should be rejected
    { projection: { unknownField: 1 } }
  );

  // findOneAndUpsert: doc inside UpsertResult also reflects KSelect
  async function upsertWithSelect() {
    const { doc } = await privateStore.findOneAndUpsert(
      { title: 'x' },
      { $setOnInsert: { title: 'x', secret: 's' } },
      { select: ['secret'] }
    );
    void doc?.secret; // ✅ un-hidden via select
  }
  void upsertWithSelect;
}
void assertFindOneAndUpdateTypeSafety;

function assertExtendedStoreDotNotationTypeSafety() {
  const baseStore = new Store('baseStore', {
    schema: {
      name: schema.string(),
      meta: schema
        .object({
          active: schema.boolean(),
        })
        .optional(),
    },
    indexes: [],
    methods: undefined,
  });

  const extendedStore = baseStore.extend({
    schema: {
      integrations: schema
        .object({
          resend: schema
            .object({
              id: schema.string().optional(),
              syncStatus: schema.enum(['success', 'error']),
              syncedAt: schema.date(),
            })
            .optional(),
        })
        .optional(),
    },
  });

  // Dot-notation paths must be accepted in filter queries on extended stores
  void extendedStore.findOne({ 'integrations.resend.syncStatus': 'success' });
  void extendedStore.fetch({
    'integrations.resend.syncStatus': 'error',
    $or: [
      { 'integrations.resend.id': { $exists: false } },
      { 'integrations.resend.syncedAt': { $lte: new Date() } },
    ],
  });

  // Dot-notation paths must be accepted in $set updates on extended stores
  void extendedStore.updateOne('someId', {
    $set: {
      'integrations.resend.id': 'abc',
      'integrations.resend.syncStatus': 'success',
      'integrations.resend.syncedAt': new Date(),
    },
  });
}
void assertExtendedStoreDotNotationTypeSafety;

describe('data/store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('extend merges schema and indexes and forbids extending after init', () => {
    const store = createStore({
      indexes: [{ key: { name: 1 }, name: 'nameIdx' }],
    });

    const extended = store.extend({
      schema: { age: {} } as ModelSchema,
      indexes: [{ key: { age: 1 }, name: 'ageIdx' }],
      searchIndexes: [{ name: 'search', definition: {} } as SearchIndexDescription],
    });

    expect(extended.getSchema()).toMatchObject({
      name: expect.anything(),
      age: expect.anything(),
    });
    const extendedIndexes = (extended as unknown as { indexes: IndexDescription[] }).indexes;
    expect(extendedIndexes.length).toBe(2);
    // Verify _modelence_ prefix is added
    expect(extendedIndexes[0].name).toBe('_modelence_nameIdx');
    expect(extendedIndexes[1].name).toBe('_modelence_ageIdx');

    const mockClient = {
      db: () => ({
        collection: () => ({}),
      }),
    } as unknown as Parameters<Store<ModelSchema, Record<string, never>>['init']>[0];

    store.init(mockClient);
    expect(() => store.extend({})).toThrow(
      "Store.extend() must be called before startApp(). Store 'testCollection' has already been initialized and cannot be extended."
    );
  });

  test('createIndexes reconciles conflicting index definitions and retries duplicate search indexes', async () => {
    const store = createStore({
      indexes: [{ key: { name: 1 }, name: 'nameIdx', unique: true }],
      searchIndexes: [{ name: 'searchIdx', definition: {} } as SearchIndexDescription],
    });

    const searchError = new MongoError('duplicate search') as MongoError & { code: number };
    searchError.code = 68;

    const collectionMock = {
      listIndexes: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          { name: '_id_', key: { _id: 1 } },
          // Same name, but stale options (missing unique) - should be replaced by code definition
          { name: '_modelence_nameIdx', key: { name: 1 } },
        ] as never),
      }),
      createIndexes: vi.fn().mockResolvedValue(undefined as never),
      dropIndex: vi.fn().mockResolvedValue(undefined as never),
      createSearchIndexes: vi
        .fn()
        .mockRejectedValueOnce(searchError as never)
        .mockResolvedValueOnce(undefined as never),
      dropSearchIndex: vi.fn().mockResolvedValue(undefined as never),
    };

    (store as unknown as { collection: typeof collectionMock }).collection = collectionMock;

    await store.createIndexes();

    expect(collectionMock.listIndexes).toHaveBeenCalled();
    expect(collectionMock.createIndexes).toHaveBeenCalledTimes(1);
    expect(collectionMock.dropIndex).toHaveBeenCalledWith('_modelence_nameIdx');
    expect(collectionMock.createSearchIndexes).toHaveBeenCalledTimes(2);
    expect(collectionMock.dropSearchIndex).toHaveBeenCalledWith('searchIdx');
  });

  test('createIndexes logs an actionable report when a unique index build hits duplicates', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const store = createStore({
      indexes: [{ key: { handle: 1 }, name: 'handleIdx', unique: true }],
    });

    const duplicateError = new MongoServerError({
      errmsg:
        'E11000 duplicate key error collection: app.testCollection index: _modelence_handleIdx dup key: { handle: "taken" }',
    });
    duplicateError.code = 11000;

    const collectionMock = {
      listIndexes: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([{ name: '_id_', key: { _id: 1 } }] as never),
      }),
      createIndexes: vi.fn().mockRejectedValue(duplicateError as never),
      dropIndex: vi.fn().mockResolvedValue(undefined as never),
    };

    (store as unknown as { collection: typeof collectionMock }).collection = collectionMock;

    // The error still propagates so startup orchestration keeps its behavior.
    await expect(store.createIndexes()).rejects.toBe(duplicateError);

    expect(consoleError).toHaveBeenCalledTimes(1);
    const report = consoleError.mock.calls[0]?.[0] as string;
    expect(report).toContain('[modelence:index-error]');
    expect(report).toContain("collection 'testCollection'");
    expect(report).toContain('db.getCollection("testCollection").aggregate(');

    consoleError.mockRestore();
  });

  test('createIndexes does not log a duplicate-key report for non-unique index failures', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const store = createStore({
      indexes: [{ key: { handle: 1 }, name: 'handleIdx' }],
    });

    const otherError = new MongoServerError({ errmsg: 'exceeded memory limit' });
    otherError.code = 292;

    const collectionMock = {
      listIndexes: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([{ name: '_id_', key: { _id: 1 } }] as never),
      }),
      createIndexes: vi.fn().mockRejectedValue(otherError as never),
      dropIndex: vi.fn().mockResolvedValue(undefined as never),
    };

    (store as unknown as { collection: typeof collectionMock }).collection = collectionMock;

    await expect(store.createIndexes()).rejects.toBe(otherError);
    expect(consoleError).not.toHaveBeenCalled();

    consoleError.mockRestore();
  });

  test('createIndexes drops auto-named indexes when options change', async () => {
    const store = createStore({
      indexes: [{ key: { title: 1, completed: 1 }, unique: true }],
    });

    const collectionMock = {
      listIndexes: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          { name: '_id_', key: { _id: 1 } },
          { name: '_modelence_title_1_completed_1', key: { title: 1, completed: 1 } },
        ] as never),
      }),
      createIndexes: vi.fn().mockResolvedValue(undefined as never),
      dropIndex: vi.fn().mockResolvedValue(undefined as never),
    };

    (store as unknown as { collection: typeof collectionMock }).collection = collectionMock;

    await store.createIndexes();

    expect(collectionMock.dropIndex).toHaveBeenCalledWith('_modelence_title_1_completed_1');
    expect(collectionMock.createIndexes).toHaveBeenCalledTimes(1);
  });

  test('createIndexes replaces conflicting manual indexes with code-defined index names', async () => {
    const store = createStore({
      indexes: [{ key: { environmentId: 1, chatId: 1, position: 1 } }],
    });

    const collectionMock = {
      listIndexes: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          { name: '_id_', key: { _id: 1 } },
          {
            name: 'environmentId_1_chatId_1_position_1',
            key: { environmentId: 1, chatId: 1, position: 1 },
          },
        ] as never),
      }),
      createIndexes: vi.fn().mockResolvedValue(undefined as never),
      dropIndex: vi.fn().mockResolvedValue(undefined as never),
    };

    (store as unknown as { collection: typeof collectionMock }).collection = collectionMock;

    await store.createIndexes();

    expect(collectionMock.dropIndex).toHaveBeenCalledWith('environmentId_1_chatId_1_position_1');
    expect(collectionMock.createIndexes).toHaveBeenCalledTimes(1);
  });

  test('createIndexes drops orphaned _modelence_ indexes and keeps non-conflicting manual indexes', async () => {
    const store = createStore({
      indexes: [{ key: { name: 1 } }],
    });

    const collectionMock = {
      listIndexes: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          { name: '_id_', key: { _id: 1 } }, // Default index, should not be dropped
          { name: '_modelence_name_1', key: { name: 1 } }, // Current index, should be kept
          { name: '_modelence_oldField_1', key: { oldField: 1 } }, // Orphaned index, should be dropped
          { name: 'customIndex_1', key: { customField: 1 } }, // Non-modelence index, should not be dropped
        ] as never),
      }),
      createIndexes: vi.fn().mockResolvedValue(undefined as never),
      dropIndex: vi.fn().mockResolvedValue(undefined as never),
    };

    (store as unknown as { collection: typeof collectionMock }).collection = collectionMock;

    await store.createIndexes();

    // Should only drop the orphaned _modelence_ index
    expect(collectionMock.dropIndex).toHaveBeenCalledTimes(1);
    expect(collectionMock.dropIndex).toHaveBeenCalledWith('_modelence_oldField_1');
    expect(collectionMock.createIndexes).not.toHaveBeenCalled();
  });

  test('createIndexes drop-only mode drops orphaned indexes without creating new ones', async () => {
    const store = createStore({
      indexes: [{ key: { name: 1 } }],
    });

    const collectionMock = {
      listIndexes: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          { name: '_id_', key: { _id: 1 } },
          { name: '_modelence_oldField_1', key: { oldField: 1 } },
        ] as never),
      }),
      createIndexes: vi.fn().mockResolvedValue(undefined as never),
      dropIndex: vi.fn().mockResolvedValue(undefined as never),
      createSearchIndexes: vi.fn().mockResolvedValue(undefined as never),
      dropSearchIndex: vi.fn().mockResolvedValue(undefined as never),
    };

    (store as unknown as { collection: typeof collectionMock }).collection = collectionMock;

    await store.createIndexes('drop-only');

    expect(collectionMock.dropIndex).toHaveBeenCalledWith('_modelence_oldField_1');
    expect(collectionMock.createIndexes).not.toHaveBeenCalled();
    expect(collectionMock.createSearchIndexes).not.toHaveBeenCalled();
    expect(collectionMock.dropSearchIndex).not.toHaveBeenCalled();
  });

  test('createIndexes create-only mode creates missing indexes without dropping any', async () => {
    const store = createStore({
      indexes: [{ key: { name: 1 } }],
    });

    const collectionMock = {
      listIndexes: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([{ name: '_id_', key: { _id: 1 } }] as never),
      }),
      createIndexes: vi.fn().mockResolvedValue(undefined as never),
      dropIndex: vi.fn().mockResolvedValue(undefined as never),
      createSearchIndexes: vi.fn().mockResolvedValue(undefined as never),
      dropSearchIndex: vi.fn().mockResolvedValue(undefined as never),
    };

    (store as unknown as { collection: typeof collectionMock }).collection = collectionMock;

    await store.createIndexes('create-only');

    expect(collectionMock.createIndexes).toHaveBeenCalledWith([
      { key: { name: 1 }, name: '_modelence_name_1' },
    ]);
    expect(collectionMock.dropIndex).not.toHaveBeenCalled();
    expect(collectionMock.dropSearchIndex).not.toHaveBeenCalled();
  });

  test('createIndexes create-only mode drops and recreates search indexes on conflict', async () => {
    const store = createStore({
      searchIndexes: [{ name: 'searchIdx', definition: {} } as SearchIndexDescription],
    });

    const searchError = new MongoError('duplicate search') as MongoError & { code: number };
    searchError.code = 68;

    const collectionMock = {
      listIndexes: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([{ name: '_id_', key: { _id: 1 } }] as never),
      }),
      createIndexes: vi.fn().mockResolvedValue(undefined as never),
      dropIndex: vi.fn().mockResolvedValue(undefined as never),
      createSearchIndexes: vi
        .fn()
        .mockRejectedValueOnce(searchError as never)
        .mockResolvedValueOnce(undefined as never),
      dropSearchIndex: vi.fn().mockResolvedValue(undefined as never),
    };

    (store as unknown as { collection: typeof collectionMock }).collection = collectionMock;

    await store.createIndexes('create-only');

    expect(collectionMock.createSearchIndexes).toHaveBeenCalledTimes(2);
    expect(collectionMock.dropSearchIndex).toHaveBeenCalledWith('searchIdx');
    expect(collectionMock.dropIndex).not.toHaveBeenCalled();
  });

  test('createIndexes handles non-existent collection (code 26)', async () => {
    const store = createStore({
      indexes: [{ key: { name: 1 } }],
    });

    const namespaceError = new MongoError('ns not found') as MongoError & { code: number };
    namespaceError.code = 26;

    const collectionMock = {
      listIndexes: vi.fn().mockReturnValue({
        toArray: vi.fn().mockRejectedValue(namespaceError as never),
      }),
      createIndexes: vi.fn().mockResolvedValue(undefined as never),
      dropIndex: vi.fn().mockResolvedValue(undefined as never),
    };

    (store as unknown as { collection: typeof collectionMock }).collection = collectionMock;

    await store.createIndexes();

    // Should not throw and should still create indexes
    expect(collectionMock.dropIndex).not.toHaveBeenCalled();
    expect(collectionMock.createIndexes).toHaveBeenCalled();
  });

  test('createIndexes ignores index-not-found (code 27) during drop and continues reconciliation', async () => {
    const store = createStore({
      indexes: [{ key: { handle: 1 }, name: 'handleIdx' }],
    });

    const indexNotFoundError = new MongoError('index not found') as MongoError & { code: number };
    indexNotFoundError.code = 27;

    const collectionMock = {
      listIndexes: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          { name: '_id_', key: { _id: 1 } },
          // Conflicting manual index with same key should be dropped, but race may already remove it
          { name: 'handle_1', key: { handle: 1 } },
        ] as never),
      }),
      createIndexes: vi.fn().mockResolvedValue(undefined as never),
      dropIndex: vi.fn().mockRejectedValue(indexNotFoundError as never),
    };

    (store as unknown as { collection: typeof collectionMock }).collection = collectionMock;

    await expect(store.createIndexes()).resolves.toBeUndefined();
    expect(collectionMock.dropIndex).toHaveBeenCalledWith('handle_1');
    expect(collectionMock.createIndexes).toHaveBeenCalledWith([
      { key: { handle: 1 }, name: '_modelence_handleIdx' },
    ]);
  });

  test('normalizes index names with _modelence_ prefix', () => {
    // Test auto-generated name
    const store1 = createStore({
      indexes: [{ key: { userId: 1 } }],
    });
    const indexes1 = (store1 as unknown as { indexes: IndexDescription[] }).indexes;
    expect(indexes1[0].name).toBe('_modelence_userId_1');

    // Test explicit name gets prefixed
    const store2 = createStore({
      indexes: [{ key: { userId: 1 }, name: 'customName' }],
    });
    const indexes2 = (store2 as unknown as { indexes: IndexDescription[] }).indexes;
    expect(indexes2[0].name).toBe('_modelence_customName');

    // Test already prefixed name stays the same
    const store3 = createStore({
      indexes: [{ key: { userId: 1 }, name: '_modelence_alreadyPrefixed' }],
    });
    const indexes3 = (store3 as unknown as { indexes: IndexDescription[] }).indexes;
    expect(indexes3[0].name).toBe('_modelence_alreadyPrefixed');

    // Test compound index auto-generated name
    const store4 = createStore({
      indexes: [{ key: { userId: 1, createdAt: -1 } }],
    });
    const indexes4 = (store4 as unknown as { indexes: IndexDescription[] }).indexes;
    expect(indexes4[0].name).toBe('_modelence_userId_1_createdAt_-1');
  });

  test('extend from historical node appends to chain tail instead of branching', () => {
    const base = createStore({
      indexes: [{ key: { name: 1 }, name: 'nameIdx' }],
    });

    const mid = base.extend({
      schema: { age: {} } as ModelSchema,
      indexes: [{ key: { age: 1 }, name: 'ageIdx' }],
    });

    // Calling extend on the base should extend from the tail (mid), not from base
    const top = base.extend({
      schema: { email: {} } as ModelSchema,
      indexes: [{ key: { email: 1 }, name: 'emailIdx' }],
    });

    // top should contain all accumulated fields: name + age + email
    expect(top.getSchema()).toMatchObject({
      name: expect.anything(),
      age: expect.anything(),
      email: expect.anything(),
    });

    const topIndexes = (top as unknown as { indexes: IndexDescription[] }).indexes;
    expect(topIndexes.length).toBe(3);
    expect(topIndexes.map((i) => i.name)).toEqual([
      '_modelence_nameIdx',
      '_modelence_ageIdx',
      '_modelence_emailIdx',
    ]);

    // Chain links are correct
    expect(base.getChainTail()).toBe(top);
    expect(top.getChainRoot()).toBe(base);
    expect(mid.getChainTail()).toBe(top);
  });

  test('extend-after-init guard checks tail', () => {
    const base = createStore();
    const extended = base.extend({ schema: { age: {} } as ModelSchema });

    const mockClient = {
      db: () => ({
        collection: () => ({}),
      }),
    } as unknown as Parameters<Store<ModelSchema, Record<string, never>>['init']>[0];

    // Init the tail
    extended.init(mockClient);

    // Extending from base should throw because the tail is init'd
    expect(() => base.extend({})).toThrow(
      "Store.extend() must be called before startApp(). Store 'testCollection' has already been initialized and cannot be extended."
    );
  });

  test('getChainTail and getChainRoot on a single store return itself', () => {
    const store = createStore();
    expect(store.getChainTail()).toBe(store);
    expect(store.getChainRoot()).toBe(store);
  });

  test('supports per-store index creation mode', () => {
    const backgroundStore = createStore();
    const blockingStore = createStore({ indexCreationMode: 'blocking' });

    expect(backgroundStore.getIndexCreationMode()).toBe('background');
    expect(blockingStore.getIndexCreationMode()).toBe('blocking');
    expect(blockingStore.extend({}).getIndexCreationMode()).toBe('blocking');
    expect(blockingStore.extend({ indexCreationMode: 'background' }).getIndexCreationMode()).toBe(
      'background'
    );
  });

  test('updateOne converts string selectors into ObjectIds', async () => {
    const store = createStore();
    const collectionMock = {
      updateOne: vi.fn().mockResolvedValue(undefined as never),
    };

    (store as unknown as { collection: typeof collectionMock }).collection = collectionMock;

    const id = '507f1f77bcf86cd799439011';
    await store.updateOne(id, { $set: { name: 'updated' } } as never);

    const calledFilter = collectionMock.updateOne.mock.calls[0]?.[0] as { _id?: ObjectId };
    expect(calledFilter?._id).toBeInstanceOf(ObjectId);
    expect((calledFilter?._id as ObjectId).toHexString()).toBe(id);
  });

  test('fetch forwards projection and cursor options to MongoDB find', async () => {
    const store = createStore();
    const cursorMock = {
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([{ _id: new ObjectId(), name: 'test' }] as never),
    };
    const collectionMock = {
      find: vi.fn().mockReturnValue(cursorMock as never),
    };

    (store as unknown as { collection: typeof collectionMock }).collection = collectionMock;

    const result = await store.fetch({ name: 'test' } as never, {
      projection: { name: 1 },
      sort: { name: 1 },
      limit: 5,
      skip: 2,
    });

    expect(collectionMock.find).toHaveBeenCalledWith({ name: 'test' }, { projection: { name: 1 } });
    expect(cursorMock.sort).toHaveBeenCalledWith({ name: 1 });
    expect(cursorMock.limit).toHaveBeenCalledWith(5);
    expect(cursorMock.skip).toHaveBeenCalledWith(2);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ name: 'test' });
  });

  test('create applies schema defaults before insert and return', async () => {
    const store = new Store('todos', {
      schema: {
        title: schema.string(),
        completed: schema.boolean(),
        category: schema.string().default('general').optional(),
        meta: schema
          .object({
            source: schema.string().default('manual').optional(),
          })
          .optional(),
      },
      indexes: [],
      methods: undefined,
    });
    const collectionMock = {
      insertOne: vi.fn().mockResolvedValue({ insertedId: new ObjectId() } as never),
    };

    (store as unknown as { collection: typeof collectionMock }).collection = collectionMock;

    const result = await store.create({
      title: 'Buy milk',
      completed: false,
      meta: {},
    });
    const insertedDocument = collectionMock.insertOne.mock.calls[0]?.[0] as {
      _id?: ObjectId;
      category?: string;
      meta?: { source?: string };
    };

    expect(result.category).toBe('general');
    expect(result.meta?.source).toBe('manual');
    expect(insertedDocument).toMatchObject({
      category: 'general',
      meta: { source: 'manual' },
    });
    expect(insertedDocument._id).toBeInstanceOf(ObjectId);
  });

  test('vectorSearch delegates to aggregate with expected pipeline', async () => {
    const store = createStore();
    const aggregateSpy = vi
      .spyOn(store as unknown as { aggregate: typeof store.aggregate }, 'aggregate')
      .mockReturnValue('cursor' as never);

    const result = await store.vectorSearch({
      field: 'embedding',
      embedding: [0.1, 0.2],
      numCandidates: 5,
      limit: 2,
      projection: { title: 1 },
      indexName: 'customIndex',
    });

    expect(aggregateSpy).toHaveBeenCalledWith([
      {
        $vectorSearch: {
          index: 'customIndex',
          path: 'embedding',
          queryVector: [0.1, 0.2],
          numCandidates: 5,
          limit: 2,
        },
      },
      {
        $project: {
          _id: 1,
          score: { $meta: 'vectorSearchScore' },
          title: 1,
        },
      },
    ]);
    expect(result).toBe('cursor');
  });

  test('vectorIndex returns correct index definition', () => {
    const index = Store.vectorIndex({
      field: 'embedding',
      dimensions: 4,
      similarity: 'dotProduct',
      indexName: 'embeddingIndex',
    });

    expect(index).toEqual({
      type: 'vectorSearch',
      name: 'embeddingIndex',
      definition: {
        fields: [
          {
            type: 'vector',
            path: 'embedding',
            numDimensions: 4,
            similarity: 'dotProduct',
          },
        ],
      },
    });
  });

  describe('session support on write methods', () => {
    test('insertOne forwards session option to MongoDB', async () => {
      const store = createStore();
      const collectionMock = {
        insertOne: vi.fn().mockResolvedValue({ insertedId: new ObjectId() } as never),
      };
      (store as unknown as { collection: typeof collectionMock }).collection = collectionMock;

      const session = {} as Parameters<typeof store.insertOne>[1] extends { session?: infer S }
        ? NonNullable<S>
        : never;
      await store.insertOne({ name: 'test' } as never, { session });

      expect(collectionMock.insertOne).toHaveBeenCalledWith({ name: 'test' }, { session });
    });

    test('insertMany forwards session option to MongoDB', async () => {
      const store = createStore();
      const collectionMock = {
        insertMany: vi.fn().mockResolvedValue({ insertedCount: 1 } as never),
      };
      (store as unknown as { collection: typeof collectionMock }).collection = collectionMock;

      const session = {} as never;
      await store.insertMany([{ name: 'a' }, { name: 'b' }] as never, { session });

      expect(collectionMock.insertMany).toHaveBeenCalledWith([{ name: 'a' }, { name: 'b' }], {
        session,
      });
    });

    test('updateOne forwards session option to MongoDB', async () => {
      const store = createStore();
      const collectionMock = {
        updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 } as never),
      };
      (store as unknown as { collection: typeof collectionMock }).collection = collectionMock;

      const session = {} as never;
      await store.updateOne({ name: 'old' } as never, { $set: { name: 'new' } } as never, {
        session,
      });

      expect(collectionMock.updateOne).toHaveBeenCalledWith(
        { name: 'old' },
        { $set: { name: 'new' } },
        { session }
      );
    });

    test('upsertOne merges session with upsert:true', async () => {
      const store = createStore();
      const collectionMock = {
        updateOne: vi.fn().mockResolvedValue({ upsertedCount: 1 } as never),
      };
      (store as unknown as { collection: typeof collectionMock }).collection = collectionMock;

      const session = {} as never;
      await store.upsertOne({ name: 'x' } as never, { $set: { name: 'x' } } as never, { session });

      expect(collectionMock.updateOne).toHaveBeenCalledWith(
        { name: 'x' },
        { $set: { name: 'x' } },
        { upsert: true, session }
      );
    });

    test('deleteOne forwards session option to MongoDB', async () => {
      const store = createStore();
      const collectionMock = {
        deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 } as never),
      };
      (store as unknown as { collection: typeof collectionMock }).collection = collectionMock;

      const session = {} as never;
      await store.deleteOne({ name: 'test' } as never, { session });

      expect(collectionMock.deleteOne).toHaveBeenCalledWith({ name: 'test' }, { session });
    });

    test('deleteMany forwards session option to MongoDB', async () => {
      const store = createStore();
      const collectionMock = {
        deleteMany: vi.fn().mockResolvedValue({ deletedCount: 2 } as never),
      };
      (store as unknown as { collection: typeof collectionMock }).collection = collectionMock;

      const session = {} as never;
      await store.deleteMany({ name: 'test' } as never, { session });

      expect(collectionMock.deleteMany).toHaveBeenCalledWith({ name: 'test' }, { session });
    });
  });

  describe('findOneAndUpdate', () => {
    test('calls collection.findOneAndUpdate with selector and update', async () => {
      const store = createStore();
      const doc = { _id: new ObjectId(), name: 'updated' };
      const collectionMock = {
        findOneAndUpdate: vi.fn().mockResolvedValue(doc as never),
      };
      (store as unknown as { collection: typeof collectionMock }).collection = collectionMock;

      const result = await store.findOneAndUpdate(
        { name: 'old' } as never,
        { $set: { name: 'updated' } } as never
      );

      expect(collectionMock.findOneAndUpdate).toHaveBeenCalledWith(
        { name: 'old' },
        { $set: { name: 'updated' } },
        {}
      );
      expect(result).toMatchObject({ name: 'updated' });
    });

    test('returns null when document not found', async () => {
      const store = createStore();
      const collectionMock = {
        findOneAndUpdate: vi.fn().mockResolvedValue(null as never),
      };
      (store as unknown as { collection: typeof collectionMock }).collection = collectionMock;

      const result = await store.findOneAndUpdate(
        { name: 'missing' } as never,
        { $set: {} } as never
      );

      expect(result).toBeNull();
    });

    test('converts string selector to ObjectId', async () => {
      const store = createStore();
      const id = '507f1f77bcf86cd799439011';
      const collectionMock = {
        findOneAndUpdate: vi.fn().mockResolvedValue(null as never),
      };
      (store as unknown as { collection: typeof collectionMock }).collection = collectionMock;

      await store.findOneAndUpdate(id, { $set: { name: 'x' } } as never);

      const calledFilter = collectionMock.findOneAndUpdate.mock.calls[0]?.[0] as { _id?: ObjectId };
      expect(calledFilter?._id).toBeInstanceOf(ObjectId);
      expect((calledFilter?._id as ObjectId).toHexString()).toBe(id);
    });

    test('forwards options to MongoDB', async () => {
      const store = createStore();
      const collectionMock = {
        findOneAndUpdate: vi.fn().mockResolvedValue(null as never),
      };
      (store as unknown as { collection: typeof collectionMock }).collection = collectionMock;

      await store.findOneAndUpdate({ name: 'test' } as never, { $set: { name: 'x' } } as never, {
        returnDocument: 'after',
      });

      expect(collectionMock.findOneAndUpdate).toHaveBeenCalledWith(
        { name: 'test' },
        { $set: { name: 'x' } },
        { returnDocument: 'after' }
      );
    });
  });

  describe('findOneAndDelete', () => {
    test('calls collection.findOneAndDelete with selector', async () => {
      const store = createStore();
      const doc = { _id: new ObjectId(), name: 'deleted' };
      const collectionMock = {
        findOneAndDelete: vi.fn().mockResolvedValue(doc as never),
      };
      (store as unknown as { collection: typeof collectionMock }).collection = collectionMock;

      const result = await store.findOneAndDelete({ name: 'deleted' } as never);

      expect(collectionMock.findOneAndDelete).toHaveBeenCalledWith({ name: 'deleted' }, {});
      expect(result).toMatchObject({ name: 'deleted' });
    });

    test('returns null when document not found', async () => {
      const store = createStore();
      const collectionMock = {
        findOneAndDelete: vi.fn().mockResolvedValue(null as never),
      };
      (store as unknown as { collection: typeof collectionMock }).collection = collectionMock;

      const result = await store.findOneAndDelete({ name: 'missing' } as never);

      expect(result).toBeNull();
    });

    test('converts string selector to ObjectId', async () => {
      const store = createStore();
      const id = '507f1f77bcf86cd799439011';
      const collectionMock = {
        findOneAndDelete: vi.fn().mockResolvedValue(null as never),
      };
      (store as unknown as { collection: typeof collectionMock }).collection = collectionMock;

      await store.findOneAndDelete(id);

      const calledFilter = collectionMock.findOneAndDelete.mock.calls[0]?.[0] as { _id?: ObjectId };
      expect(calledFilter?._id).toBeInstanceOf(ObjectId);
    });
  });

  describe('findOneAndReplace', () => {
    test('calls collection.findOneAndReplace with selector and replacement', async () => {
      const store = createStore();
      const doc = { _id: new ObjectId(), name: 'replacement' };
      const collectionMock = {
        findOneAndReplace: vi.fn().mockResolvedValue(doc as never),
      };
      (store as unknown as { collection: typeof collectionMock }).collection = collectionMock;

      const replacement = { name: 'replacement' } as never;
      const result = await store.findOneAndReplace({ name: 'old' } as never, replacement);

      expect(collectionMock.findOneAndReplace).toHaveBeenCalledWith(
        { name: 'old' },
        replacement,
        {}
      );
      expect(result).toMatchObject({ name: 'replacement' });
    });

    test('returns null when document not found', async () => {
      const store = createStore();
      const collectionMock = {
        findOneAndReplace: vi.fn().mockResolvedValue(null as never),
      };
      (store as unknown as { collection: typeof collectionMock }).collection = collectionMock;

      const result = await store.findOneAndReplace(
        { name: 'missing' } as never,
        { name: 'new' } as never
      );

      expect(result).toBeNull();
    });
  });

  describe('replaceOne', () => {
    test('calls collection.replaceOne with selector and replacement', async () => {
      const store = createStore();
      const collectionMock = {
        replaceOne: vi.fn().mockResolvedValue({ modifiedCount: 1 } as never),
      };
      (store as unknown as { collection: typeof collectionMock }).collection = collectionMock;

      const replacement = { name: 'new' } as never;
      await store.replaceOne({ name: 'old' } as never, replacement);

      expect(collectionMock.replaceOne).toHaveBeenCalledWith(
        { name: 'old' },
        replacement,
        undefined
      );
    });

    test('converts string selector to ObjectId', async () => {
      const store = createStore();
      const id = '507f1f77bcf86cd799439011';
      const collectionMock = {
        replaceOne: vi.fn().mockResolvedValue({ modifiedCount: 1 } as never),
      };
      (store as unknown as { collection: typeof collectionMock }).collection = collectionMock;

      await store.replaceOne(id, { name: 'new' } as never);

      const calledFilter = collectionMock.replaceOne.mock.calls[0]?.[0] as { _id?: ObjectId };
      expect(calledFilter?._id).toBeInstanceOf(ObjectId);
      expect((calledFilter?._id as ObjectId).toHexString()).toBe(id);
    });

    test('forwards options to MongoDB', async () => {
      const store = createStore();
      const collectionMock = {
        replaceOne: vi.fn().mockResolvedValue({ upsertedCount: 1 } as never),
      };
      (store as unknown as { collection: typeof collectionMock }).collection = collectionMock;

      await store.replaceOne({ name: 'x' } as never, { name: 'x' } as never, { upsert: true });

      expect(collectionMock.replaceOne).toHaveBeenCalledWith(
        { name: 'x' },
        { name: 'x' },
        { upsert: true }
      );
    });
  });

  describe('distinct', () => {
    test('returns distinct values for a field', async () => {
      const store = createStore();
      const collectionMock = {
        distinct: vi.fn().mockResolvedValue(['alice', 'bob'] as never),
      };
      (store as unknown as { collection: typeof collectionMock }).collection = collectionMock;

      const result = await store.distinct('name');

      expect(collectionMock.distinct).toHaveBeenCalledWith('name', {});
      expect(result).toEqual(['alice', 'bob']);
    });

    test('passes filter to MongoDB', async () => {
      const store = createStore();
      const collectionMock = {
        distinct: vi.fn().mockResolvedValue(['alice'] as never),
      };
      (store as unknown as { collection: typeof collectionMock }).collection = collectionMock;

      await store.distinct('name', { name: 'alice' } as never);

      expect(collectionMock.distinct).toHaveBeenCalledWith('name', { name: 'alice' });
    });

    test('passes options to MongoDB when provided', async () => {
      const store = createStore();
      const collectionMock = {
        distinct: vi.fn().mockResolvedValue([] as never),
      };
      (store as unknown as { collection: typeof collectionMock }).collection = collectionMock;

      const opts = { maxTimeMS: 1000 };
      await store.distinct('name', {} as never, opts);

      expect(collectionMock.distinct).toHaveBeenCalledWith('name', {}, opts);
    });
  });

  describe('watch', () => {
    test('calls collection.watch and returns the change stream', () => {
      const store = createStore();
      const changeStream = { on: vi.fn() };
      const collectionMock = {
        watch: vi.fn().mockReturnValue(changeStream as never),
      };
      (store as unknown as { collection: typeof collectionMock }).collection = collectionMock;

      const result = store.watch();

      expect(collectionMock.watch).toHaveBeenCalledWith(undefined, undefined);
      expect(result).toBe(changeStream);
    });

    test('forwards pipeline and options to MongoDB', () => {
      const store = createStore();
      const changeStream = {};
      const collectionMock = {
        watch: vi.fn().mockReturnValue(changeStream as never),
      };
      (store as unknown as { collection: typeof collectionMock }).collection = collectionMock;

      const pipeline = [{ $match: { operationType: 'insert' } }];
      const opts = { fullDocument: 'updateLookup' as const };
      store.watch(pipeline, opts);

      expect(collectionMock.watch).toHaveBeenCalledWith(pipeline, opts);
    });
  });

  describe('StrictRootFilterOperators', () => {
    test('$and operator works correctly', async () => {
      const store = createStore();
      const collectionMock = {
        findOne: vi.fn().mockResolvedValue({ _id: new ObjectId(), name: 'test' } as never),
      };

      (store as unknown as { collection: typeof collectionMock }).collection = collectionMock;

      await store.findOne({ $and: [{ name: 'test' }, { _id: new ObjectId() }] } as never);

      expect(collectionMock.findOne).toHaveBeenCalledTimes(1);
      const calledFilter = collectionMock.findOne.mock.calls[0]?.[0] as {
        $and?: unknown[];
      };
      expect(calledFilter?.$and).toBeDefined();
      expect(Array.isArray(calledFilter?.$and)).toBe(true);
      expect(calledFilter?.$and?.length).toBe(2);
    });

    test('$or operator works correctly', async () => {
      const store = createStore();
      const collectionMock = {
        findOne: vi.fn().mockResolvedValue({ _id: new ObjectId(), name: 'test' } as never),
      };

      (store as unknown as { collection: typeof collectionMock }).collection = collectionMock;

      await store.findOne({ $or: [{ name: 'test1' }, { name: 'test2' }] } as never);

      expect(collectionMock.findOne).toHaveBeenCalledTimes(1);
      const calledFilter = collectionMock.findOne.mock.calls[0]?.[0] as {
        $or?: unknown[];
      };
      expect(calledFilter?.$or).toBeDefined();
      expect(Array.isArray(calledFilter?.$or)).toBe(true);
      expect(calledFilter?.$or?.length).toBe(2);
    });

    test('$nor operator works correctly', async () => {
      const store = createStore();
      const collectionMock = {
        findOne: vi.fn().mockResolvedValue({ _id: new ObjectId(), name: 'test' } as never),
      };

      (store as unknown as { collection: typeof collectionMock }).collection = collectionMock;

      await store.findOne({ $nor: [{ name: 'excluded1' }, { name: 'excluded2' }] } as never);

      expect(collectionMock.findOne).toHaveBeenCalledTimes(1);
      const calledFilter = collectionMock.findOne.mock.calls[0]?.[0] as {
        $nor?: unknown[];
      };
      expect(calledFilter?.$nor).toBeDefined();
      expect(Array.isArray(calledFilter?.$nor)).toBe(true);
      expect(calledFilter?.$nor?.length).toBe(2);
    });

    test('$not operator works correctly', async () => {
      const store = createStore();
      const collectionMock = {
        findOne: vi.fn().mockResolvedValue({ _id: new ObjectId(), name: 'test' } as never),
      };

      (store as unknown as { collection: typeof collectionMock }).collection = collectionMock;

      await store.findOne({ $not: { name: 'excluded' } } as never);

      expect(collectionMock.findOne).toHaveBeenCalledTimes(1);
      const calledFilter = collectionMock.findOne.mock.calls[0]?.[0] as {
        $not?: unknown;
      };
      expect(calledFilter?.$not).toBeDefined();
    });

    test('$text operator with all options works correctly', async () => {
      const store = createStore();
      const collectionMock = {
        findOne: vi.fn().mockResolvedValue({ _id: new ObjectId(), name: 'test' } as never),
      };

      (store as unknown as { collection: typeof collectionMock }).collection = collectionMock;

      await store.findOne({
        $text: {
          $search: 'coffee',
          $language: 'en',
          $caseSensitive: true,
          $diacriticSensitive: false,
        },
      } as never);

      expect(collectionMock.findOne).toHaveBeenCalledTimes(1);
      const calledFilter = collectionMock.findOne.mock.calls[0]?.[0] as {
        $text?: {
          $search?: string;
          $language?: string;
          $caseSensitive?: boolean;
          $diacriticSensitive?: boolean;
        };
      };
      expect(calledFilter?.$text).toBeDefined();
      expect(calledFilter?.$text?.$search).toBe('coffee');
      expect(calledFilter?.$text?.$language).toBe('en');
      expect(calledFilter?.$text?.$caseSensitive).toBe(true);
      expect(calledFilter?.$text?.$diacriticSensitive).toBe(false);
    });

    test('$text operator with minimal options works correctly', async () => {
      const store = createStore();
      const collectionMock = {
        findOne: vi.fn().mockResolvedValue({ _id: new ObjectId(), name: 'test' } as never),
      };

      (store as unknown as { collection: typeof collectionMock }).collection = collectionMock;

      await store.findOne({
        $text: {
          $search: 'coffee',
        },
      } as never);

      expect(collectionMock.findOne).toHaveBeenCalledTimes(1);
      const calledFilter = collectionMock.findOne.mock.calls[0]?.[0] as {
        $text?: {
          $search?: string;
        };
      };
      expect(calledFilter?.$text).toBeDefined();
      expect(calledFilter?.$text?.$search).toBe('coffee');
    });

    test('$where operator with string works correctly', async () => {
      const store = createStore();
      const collectionMock = {
        findOne: vi.fn().mockResolvedValue({ _id: new ObjectId(), name: 'test' } as never),
      };

      (store as unknown as { collection: typeof collectionMock }).collection = collectionMock;

      await store.findOne({
        $where: 'this.name.length > 5',
      } as never);

      expect(collectionMock.findOne).toHaveBeenCalledTimes(1);
      const calledFilter = collectionMock.findOne.mock.calls[0]?.[0] as {
        $where?: string | ((this: unknown) => boolean);
      };
      expect(calledFilter?.$where).toBe('this.name.length > 5');
    });

    test('$where operator with function works correctly', async () => {
      const store = createStore();
      const collectionMock = {
        findOne: vi.fn().mockResolvedValue({ _id: new ObjectId(), name: 'test' } as never),
      };

      (store as unknown as { collection: typeof collectionMock }).collection = collectionMock;

      const whereFunction = function (this: { name: string }) {
        return this.name.length > 5;
      };

      await store.findOne({
        $where: whereFunction,
      } as never);

      expect(collectionMock.findOne).toHaveBeenCalledTimes(1);
      const calledFilter = collectionMock.findOne.mock.calls[0]?.[0] as {
        $where?: string | ((this: unknown) => boolean);
      };
      expect(calledFilter?.$where).toBe(whereFunction);
    });

    test('$comment operator with string works correctly', async () => {
      const store = createStore();
      const collectionMock = {
        findOne: vi.fn().mockResolvedValue({ _id: new ObjectId(), name: 'test' } as never),
      };

      (store as unknown as { collection: typeof collectionMock }).collection = collectionMock;

      await store.findOne({
        $comment: 'Query for testing',
        name: 'test',
      } as never);

      expect(collectionMock.findOne).toHaveBeenCalledTimes(1);
      const calledFilter = collectionMock.findOne.mock.calls[0]?.[0] as {
        $comment?: string;
      };
      expect(calledFilter?.$comment).toBe('Query for testing');
    });

    test('$comment operator with Document works correctly', async () => {
      const store = createStore();
      const collectionMock = {
        findOne: vi.fn().mockResolvedValue({ _id: new ObjectId(), name: 'test' } as never),
      };

      (store as unknown as { collection: typeof collectionMock }).collection = collectionMock;

      const commentDoc = { purpose: 'testing', user: 'admin' };

      await store.findOne({
        $comment: commentDoc,
        name: 'test',
      } as never);

      expect(collectionMock.findOne).toHaveBeenCalledTimes(1);
      const calledFilter = collectionMock.findOne.mock.calls[0]?.[0] as {
        $comment?: { purpose: string; user: string };
      };
      expect(calledFilter?.$comment).toEqual(commentDoc);
    });

    test('$expr operator works correctly', async () => {
      const store = createStore();
      const collectionMock = {
        findOne: vi.fn().mockResolvedValue({ _id: new ObjectId(), name: 'test' } as never),
      };

      (store as unknown as { collection: typeof collectionMock }).collection = collectionMock;

      await store.findOne({
        $expr: { $gt: ['$field1', '$field2'] },
      } as never);

      expect(collectionMock.findOne).toHaveBeenCalledTimes(1);
      const calledFilter = collectionMock.findOne.mock.calls[0]?.[0] as {
        $expr?: unknown;
      };
      expect(calledFilter?.$expr).toBeDefined();
      expect(calledFilter?.$expr).toEqual({ $gt: ['$field1', '$field2'] });
    });

    test('$jsonSchema operator works correctly', async () => {
      const store = createStore();
      const collectionMock = {
        findOne: vi.fn().mockResolvedValue({ _id: new ObjectId(), name: 'test' } as never),
      };

      (store as unknown as { collection: typeof collectionMock }).collection = collectionMock;

      const schema = {
        required: ['name'],
        properties: {
          name: { type: 'string' },
        },
      };

      await store.findOne({
        $jsonSchema: schema,
      } as never);

      expect(collectionMock.findOne).toHaveBeenCalledTimes(1);
      const calledFilter = collectionMock.findOne.mock.calls[0]?.[0] as {
        $jsonSchema?: unknown;
      };
      expect(calledFilter?.$jsonSchema).toEqual(schema);
    });

    test('combining multiple StrictRootFilterOperators works correctly', async () => {
      const store = createStore();
      const collectionMock = {
        findOne: vi.fn().mockResolvedValue({ _id: new ObjectId(), name: 'test' } as never),
      };

      (store as unknown as { collection: typeof collectionMock }).collection = collectionMock;

      await store.findOne({
        $and: [{ name: 'test' }],
        $comment: 'Complex query',
        $expr: { $gt: ['$value', 10] },
      } as never);

      expect(collectionMock.findOne).toHaveBeenCalledTimes(1);
      const calledFilter = collectionMock.findOne.mock.calls[0]?.[0] as {
        $and?: unknown[];
        $comment?: string;
        $expr?: unknown;
      };
      expect(calledFilter?.$and).toBeDefined();
      expect(calledFilter?.$comment).toBe('Complex query');
      expect(calledFilter?.$expr).toEqual({ $gt: ['$value', 10] });
    });
  });

  describe('private fields and options.select', () => {
    const createPrivateStore = () =>
      new Store('private_users', {
        schema: {
          name: schema.string(),
          email: schema.string(),
          password: schema.string().private(),
          pin: schema.number().private(),
        },
        indexes: [],
      });

    test('should exclude private fields by default on findOne and fetch', async () => {
      const store = createPrivateStore();
      const toArrayMock = vi
        .fn()
        .mockResolvedValue([{ _id: new ObjectId(), name: 'Alice', email: 'alice@test.com' }]);
      const collectionMock = {
        findOne: vi
          .fn()
          .mockResolvedValue({ _id: new ObjectId(), name: 'Alice', email: 'alice@test.com' }),
        find: vi.fn().mockReturnValue({ toArray: toArrayMock }),
      };

      (store as unknown as { collection: typeof collectionMock }).collection = collectionMock;

      await store.findOne({ name: 'Alice' });
      expect(collectionMock.findOne).toHaveBeenCalledWith({ name: 'Alice' }, undefined);

      await store.fetch({ name: 'Alice' });
      expect(collectionMock.find).toHaveBeenCalledWith({ name: 'Alice' }, undefined);
    });

    test('store.findOne and store.fetch with options.select should un-hide selected private fields', async () => {
      const store = createPrivateStore();
      const toArrayMock = vi
        .fn()
        .mockResolvedValue([
          { _id: new ObjectId(), name: 'Alice', email: 'alice@test.com', password: 'hash' },
        ]);
      const collectionMock = {
        findOne: vi.fn().mockResolvedValue({
          _id: new ObjectId(),
          name: 'Alice',
          email: 'alice@test.com',
          password: 'hash',
        }),
        find: vi.fn().mockReturnValue({ toArray: toArrayMock }),
      };

      (store as unknown as { collection: typeof collectionMock }).collection = collectionMock;

      await store.findOne({ name: 'Alice' }, { select: ['password'] });
      expect(collectionMock.findOne).toHaveBeenCalledWith({ name: 'Alice' }, undefined);

      await store.fetch({ name: 'Alice' }, { select: ['password', 'pin'] });
      expect(collectionMock.find).toHaveBeenCalledWith({ name: 'Alice' }, undefined);
    });

    test('should NOT un-hide private primitive fields when invalid sub-path like password.foo is selected', async () => {
      const store = createPrivateStore();
      const collectionMock = {
        findOne: vi.fn().mockResolvedValue({
          _id: new ObjectId(),
          name: 'Alice',
          email: 'alice@test.com',
          password: 'hash',
        }),
      };

      (store as unknown as { collection: typeof collectionMock }).collection = collectionMock;

      // Select 'password.foo' (which starts with 'password.') on primitive field 'password'
      const doc = await store.findOne({ name: 'Alice' }, { select: ['password.foo' as any] });

      // password must be stripped and not leaked!
      expect(doc).not.toHaveProperty('password');
    });

    test('should NOT treat Date or ObjectId instances as sub-path container objects', async () => {
      const dateStore = new Store('dateStore', {
        schema: {
          title: schema.string(),
          secretDate: schema.date().private(),
        },
        indexes: [],
      });

      const collectionMock = {
        findOne: vi.fn().mockResolvedValue({
          _id: new ObjectId(),
          title: 'Event',
          secretDate: new Date(),
        }),
      };
      (dateStore as unknown as { collection: typeof collectionMock }).collection = collectionMock;

      const doc = await dateStore.findOne(
        { title: 'Event' },
        { select: ['secretDate.foo' as any] }
      );
      expect(doc).not.toHaveProperty('secretDate');
    });

    test('should NOT treat an array of primitive strings as a container when invalid sub-path is selected', async () => {
      const tokenStore = new Store('tokenStore', {
        schema: {
          title: schema.string(),
          secretTokens: schema.array(schema.string()).private(),
        },
        indexes: [],
      });

      const collectionMock = {
        findOne: vi.fn().mockResolvedValue({
          _id: new ObjectId(),
          title: 'Tokens',
          secretTokens: ['token_1', 'token_2'],
        }),
      };
      (tokenStore as unknown as { collection: typeof collectionMock }).collection = collectionMock;

      const doc = await tokenStore.findOne(
        { title: 'Tokens' },
        { select: ['secretTokens.foo' as any] }
      );
      expect(doc).not.toHaveProperty('secretTokens');
    });

    test('should preserve private fields when MongoDB projection operators like $slice are used', async () => {
      const commentStore = new Store('commentStore', {
        schema: {
          title: schema.string(),
          comments: schema
            .array(
              schema.object({
                text: schema.string(),
              })
            )
            .private(),
        },
        indexes: [],
      });

      const collectionMock = {
        findOne: vi.fn().mockResolvedValue({
          _id: new ObjectId(),
          title: 'Post',
          comments: [{ text: 'Great post!' }],
        }),
      };
      (commentStore as unknown as { collection: typeof collectionMock }).collection =
        collectionMock;

      const doc = await commentStore.findOne(
        { title: 'Post' },
        { projection: { comments: { $slice: 1 } } }
      );
      expect(doc?.comments).toBeDefined();
      expect(doc?.comments[0].text).toBe('Great post!');
    });

    test('should preserve private empty array container when selecting sub-path', async () => {
      const emptyArrayStore = new Store('emptyArrayStore', {
        schema: {
          title: schema.string(),
          players: schema
            .array(
              schema.object({
                profile: schema.object({ email: schema.string() }),
              })
            )
            .private(),
        },
        indexes: [],
      });

      const collectionMock = {
        findOne: vi.fn().mockResolvedValue({
          _id: new ObjectId(),
          title: 'Empty Game',
          players: [],
        }),
      };
      (emptyArrayStore as unknown as { collection: typeof collectionMock }).collection =
        collectionMock;

      const doc = await emptyArrayStore.findOne(
        { title: 'Empty Game' },
        { select: ['players.profile.email' as any] }
      );

      // Empty array players must be preserved as [] and not deleted!
      expect(doc?.players).toBeDefined();
      expect(doc?.players).toEqual([]);
    });

    test('store.findOne and store.fetch with nested and parent private fields should hide/un-hide correctly', async () => {
      const profileStore = new Store('userProfiles', {
        schema: {
          username: schema.string(),
          metadata: schema.object({
            internal: schema.object({
              pin: schema.number().private(),
              score: schema.number(),
            }),
          }),
          securityCredentials: schema
            .object({
              token: schema.string(),
            })
            .private(),
        },
        indexes: [],
      });

      const toArrayMock = vi.fn().mockResolvedValue([
        {
          _id: new ObjectId(),
          username: 'alice',
          metadata: { internal: { score: 100 } },
        },
      ]);
      const collectionMock = {
        findOne: vi.fn().mockResolvedValue({
          _id: new ObjectId(),
          username: 'alice',
          metadata: { internal: { score: 100 } },
        }),
        find: vi.fn().mockReturnValue({ toArray: toArrayMock }),
      };

      (profileStore as unknown as { collection: typeof collectionMock }).collection =
        collectionMock;

      // By default without select: nested private field and parent private field are excluded
      await profileStore.findOne({ username: 'alice' });
      expect(collectionMock.findOne).toHaveBeenCalledWith({ username: 'alice' }, undefined);

      // With select for nested private field: metadata.internal.pin is un-hidden
      await profileStore.findOne({ username: 'alice' }, { select: ['metadata.internal.pin'] });
      expect(collectionMock.findOne).toHaveBeenCalledWith({ username: 'alice' }, undefined);

      // With select for parent private field: securityCredentials is un-hidden
      await profileStore.fetch({ username: 'alice' }, { select: ['securityCredentials'] });
      expect(collectionMock.find).toHaveBeenCalledWith({ username: 'alice' }, undefined);

      // With select for all private fields: projection is undefined (no fields hidden)
      await profileStore.fetch(
        { username: 'alice' },
        { select: ['metadata.internal.pin', 'securityCredentials'] }
      );
      expect(collectionMock.find).toHaveBeenCalledWith({ username: 'alice' }, undefined);
    });

    test('store.findOne and store.fetch: selecting nested array private field returns full received data', async () => {
      const organizationStore = new Store('organizations', {
        schema: {
          name: schema.string(),
          active: schema.boolean(),
          apiKey: schema.string().private(),
          teamSettings: schema.object({
            memberEmails: schema.array(schema.string()).private(),
            maxQuota: schema.number(),
            region: schema.string(),
          }),
        },
        indexes: [],
      });

      const rawDocFromMongo = {
        _id: new ObjectId(),
        name: 'Acme Corp',
        active: true,
        apiKey: 'key_live_12345',
        teamSettings: {
          memberEmails: ['admin@acme.com', 'dev@acme.com'],
          maxQuota: 500,
          region: 'us-east',
        },
      };

      const collectionMock = {
        findOne: vi
          .fn()
          .mockImplementation(() => Promise.resolve(JSON.parse(JSON.stringify(rawDocFromMongo)))),
        find: vi.fn().mockReturnValue({
          toArray: vi
            .fn()
            .mockImplementation(() =>
              Promise.resolve([JSON.parse(JSON.stringify(rawDocFromMongo))])
            ),
        }),
      };

      (organizationStore as unknown as { collection: typeof collectionMock }).collection =
        collectionMock;

      // 1. By default with no select option: apiKey and teamSettings.memberEmails are stripped by app code
      const fetchedDefault = await organizationStore.findOne({ name: 'Acme Corp' });
      expect(collectionMock.findOne).toHaveBeenCalledWith({ name: 'Acme Corp' }, undefined);
      expect(fetchedDefault).toBeDefined();
      expect(fetchedDefault?.name).toBe('Acme Corp');
      expect(fetchedDefault?.teamSettings?.maxQuota).toBe(500);
      expect((fetchedDefault as any)?.apiKey).toBeUndefined();
      expect((fetchedDefault as any)?.teamSettings?.memberEmails).toBeUndefined();

      // 2. Fetching with select for apiKey and teamSettings.memberEmails:
      const selectedOrgs = await organizationStore.fetch(
        {},
        { select: ['apiKey', 'teamSettings.memberEmails'] }
      );

      // Verify MongoDB call options are passed cleanly:
      expect(collectionMock.find).toHaveBeenCalledWith({}, undefined);

      // Verify RECEIVED data in response:
      expect(selectedOrgs).toHaveLength(1);
      const receivedDoc = selectedOrgs[0];
      expect(receivedDoc.apiKey).toBe('key_live_12345');
      expect(receivedDoc.teamSettings.memberEmails).toEqual(['admin@acme.com', 'dev@acme.com']);
      expect(receivedDoc.teamSettings.maxQuota).toBe(500);
      expect(receivedDoc.teamSettings.region).toBe('us-east');
    });

    test('store read methods with projection containing private fields un-hide private fields cleanly', async () => {
      const organizationStore = new Store('organizationsProj', {
        schema: {
          name: schema.string(),
          active: schema.boolean(),
          apiKey: schema.string().private(),
          teamSettings: schema.object({
            memberEmails: schema.array(schema.string()).private(),
            maxQuota: schema.number(),
          }),
        },
        indexes: [],
      });

      const rawDocFromMongo = {
        _id: new ObjectId(),
        name: 'Acme Corp',
        active: true,
        apiKey: 'key_live_12345',
        teamSettings: {
          memberEmails: ['admin@acme.com'],
          maxQuota: 500,
        },
      };

      const collectionMock = {
        findOne: vi.fn().mockImplementation((_query, _opts) => {
          return Promise.resolve(JSON.parse(JSON.stringify(rawDocFromMongo)));
        }),
        find: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([JSON.parse(JSON.stringify(rawDocFromMongo))]),
        }),
      };

      (organizationStore as unknown as { collection: typeof collectionMock }).collection =
        collectionMock;

      // Projection passed to findOne:
      const doc = await organizationStore.findOne(
        { name: 'Acme Corp' },
        { projection: { apiKey: 1, name: 1 } }
      );
      expect(collectionMock.findOne).toHaveBeenCalledWith(
        { name: 'Acme Corp' },
        { projection: { apiKey: 1, name: 1 } }
      );

      // Both projection and select passed together merge cleanly:
      await organizationStore.fetch(
        { name: 'Acme Corp' },
        { projection: { name: 1 }, select: ['apiKey'] }
      );
      expect(collectionMock.find).toHaveBeenCalledWith(
        { name: 'Acme Corp' },
        { projection: { name: 1, apiKey: 1 } }
      );

      // Parent projection + child select does NOT produce path collision:
      await organizationStore.fetch(
        { name: 'Acme Corp' },
        { projection: { teamSettings: 1 } as const, select: ['teamSettings.memberEmails'] }
      );
      expect(collectionMock.find).toHaveBeenLastCalledWith(
        { name: 'Acme Corp' },
        { projection: { teamSettings: 1 } }
      );

      // Exclusion projection excluding a public field ({ active: 0 }): private fields remain hidden by default
      const resExclPublic = await organizationStore.findOne(
        { name: 'Acme Corp' },
        { projection: { active: 0 } }
      );
      expect((resExclPublic as any)?.apiKey).toBeUndefined();
      expect((resExclPublic as any)?.teamSettings?.memberEmails).toBeUndefined();

      // Exclusion projection excluding one private field ({ apiKey: 0 }): all private fields remain hidden by default
      const resExclPrivate = await organizationStore.findOne(
        { name: 'Acme Corp' },
        { projection: { apiKey: 0 } as const }
      );
      expect((resExclPrivate as any)?.apiKey).toBeUndefined();
      expect((resExclPrivate as any)?.teamSettings?.memberEmails).toBeUndefined();

      // Exclusion projection with select: select explicitly un-hides selected private field (apiKey) while unselected stay hidden
      const resSelect = await organizationStore.findOne(
        { name: 'Acme Corp' },
        { projection: { active: 0 } as const, select: ['apiKey'] }
      );
      expect(resSelect?.apiKey).toBe('key_live_12345');
      expect((resSelect as any)?.teamSettings?.memberEmails).toBeUndefined();

      // Inclusion projection including a parent object: public sub-fields stay, private sub-fields are stripped
      const resParent = await organizationStore.findOne(
        { name: 'Acme Corp' },
        { projection: { teamSettings: 1 } as const }
      );
      expect(resParent?.teamSettings?.maxQuota).toBe(500);
      expect((resParent as any)?.teamSettings?.memberEmails).toBeUndefined();
    });

    it('should exclude nested private field when only private parent object is selected', async () => {
      const profileStore = new Store('userProfilesNested', {
        schema: {
          name: schema.string(),
          credentials: schema
            .object({
              password: schema.string().private(),
              emails: schema.string(),
            })
            .private(),
        },
        indexes: [],
      });

      const rawDoc = {
        _id: new ObjectId(),
        name: 'Alice',
        credentials: {
          emails: 'alice@example.com',
          password: 'supersecret',
        },
      };

      const mockCol = {
        findOne: vi.fn().mockImplementation((_query, _opts) => {
          return Promise.resolve(JSON.parse(JSON.stringify(rawDoc)));
        }),
      };

      (profileStore as unknown as { collection: typeof mockCol }).collection = mockCol;

      const result = await profileStore.findOne({ name: 'Alice' }, { select: ['credentials'] });
      expect(result?.credentials.emails).toBe('alice@example.com');
      // @ts-expect-error password is private inside credentials and was not explicitly selected
      expect(result?.credentials.password).toBeUndefined();

      // Selecting both credentials and credentials.password retains password
      const resultBoth = await profileStore.findOne(
        { name: 'Alice' },
        { select: ['credentials', 'credentials.password'] }
      );
      expect(resultBoth?.credentials.emails).toBe('alice@example.com');
      expect((resultBoth?.credentials as any)?.password).toBe('supersecret');

      // Inclusion projection for private parent object (credentials: 1) strips private sub-fields (password)
      const resultParentProj = await profileStore.findOne(
        { name: 'Alice' },
        { projection: { credentials: 1 } as const }
      );
      expect(resultParentProj?.credentials.emails).toBe('alice@example.com');
      // @ts-expect-error password is private inside credentials
      expect(resultParentProj?.credentials.password).toBeUndefined();

      // Inclusion projection with select: ['credentials'] strips unselected private fields
      const resultProjSelect = await profileStore.findOne(
        { name: 'Alice' },
        { projection: { name: 1 }, select: ['credentials'] }
      );
      expect(resultProjSelect?.credentials.emails).toBe('alice@example.com');
      // @ts-expect-error password is private inside credentials
      expect(resultProjSelect?.credentials.password).toBeUndefined();
    });

    it('should correctly strip/un-hide private fields inside nested arrays of objects', async () => {
      const gameStore = new Store('games', {
        schema: {
          title: schema.string(),
          players: schema
            .array(
              schema
                .object({
                  id: schema.string().private(),
                  username: schema.string(),
                  profile: schema
                    .array(
                      schema.object({
                        displayName: schema.string(),
                        email: schema.string().private(),
                      })
                    )
                    .private(),
                })
                .private()
            )
            .private(),
        },
        indexes: [],
      });

      const rawGameDoc = {
        _id: new ObjectId(),
        title: 'Cyberpunk',
        players: [
          {
            id: 'player_123',
            username: 'cyber_sam',
            profile: [
              {
                displayName: 'Samurai',
                email: 'sam@cyber.com',
              },
            ],
          },
        ],
      };

      const mockCol = {
        findOne: vi
          .fn()
          .mockImplementation(() => Promise.resolve(JSON.parse(JSON.stringify(rawGameDoc)))),
      };
      (gameStore as unknown as { collection: typeof mockCol }).collection = mockCol;

      // 1. By default: players array is private -> stripped completely
      const defaultDoc = await gameStore.findOne({ title: 'Cyberpunk' });
      expect(defaultDoc?.title).toBe('Cyberpunk');
      expect((defaultDoc as any)?.players).toBeUndefined();

      // 2. Selecting players, players.id, and players.profile:
      //    players.username is public (kept), players.id (kept), players.profile.displayName (kept), players.profile.email (stripped)
      const selectedDoc = await gameStore.findOne(
        { title: 'Cyberpunk' },
        { select: ['players', 'players.id', 'players.profile'] }
      );
      expect(selectedDoc?.players).toBeDefined();
      expect(selectedDoc?.players?.[0].id).toBe('player_123');
      expect(selectedDoc?.players?.[0].username).toBe('cyber_sam');
      expect(selectedDoc?.players?.[0].profile?.[0].displayName).toBe('Samurai');
      expect((selectedDoc?.players?.[0].profile?.[0] as any)?.email).toBeUndefined();

      // 3. Selecting players.profile.email as well un-hides email:
      const fullDoc = await gameStore.findOne(
        { title: 'Cyberpunk' },
        { select: ['players', 'players.id', 'players.profile', 'players.profile.email'] }
      );
      expect(fullDoc?.players?.[0].profile?.[0].email).toBe('sam@cyber.com');
    });

    test('should preserve intermediate private array container when selecting deep child path', async () => {
      const gameStore = new Store('gamesDeepSelect', {
        schema: {
          title: schema.string(),
          players: schema
            .array(
              schema.object({
                id: schema.string(),
                profile: schema
                  .array(
                    schema.object({
                      displayName: schema.string(),
                      email: schema.string().private(),
                    })
                  )
                  .private(),
              })
            )
            .private(),
        },
        indexes: [],
      });

      const rawDoc = {
        _id: new ObjectId(),
        title: 'Cyberpunk',
        players: [
          {
            id: 'p1',
            profile: [{ displayName: 'Sam', email: 'sam@cyber.com' }],
          },
        ],
      };

      const collectionMock = {
        findOne: vi.fn().mockResolvedValue(rawDoc),
      };
      (gameStore as unknown as { collection: typeof collectionMock }).collection = collectionMock;

      // Select ONLY deep path 'players.profile.displayName'
      const doc = await gameStore.findOne(
        { title: 'Cyberpunk' },
        { select: ['players.profile.displayName'] }
      );

      // Intermediate private container players.profile must NOT be deleted!
      expect(doc?.players?.[0]?.profile).toBeDefined();
      expect(doc?.players?.[0]?.profile?.[0]?.displayName).toBe('Sam');
      // Private leaf email must be stripped!
      expect((doc?.players?.[0]?.profile?.[0] as any)?.email).toBeUndefined();
    });

    test('atomic mutation methods (findOneAndUpdate, findOneAndUpsert, findOneAndDelete, findOneAndReplace) should hide private fields by default and un-hide via select', async () => {
      const mutStore = new Store('mutationTest', {
        schema: {
          title: schema.string(),
          secret: schema.string().private(),
          audit: schema.object({
            createdBy: schema.string().private(),
          }),
        },
        indexes: [],
      });

      const rawDoc = {
        _id: new ObjectId(),
        title: 'Project Alpha',
        secret: 'shhh',
        audit: { createdBy: 'admin' },
      };

      const mockCollection = {
        findOneAndUpdate: vi
          .fn()
          .mockImplementation(() => Promise.resolve(JSON.parse(JSON.stringify(rawDoc)))),
        findOneAndDelete: vi
          .fn()
          .mockImplementation(() => Promise.resolve(JSON.parse(JSON.stringify(rawDoc)))),
        findOneAndReplace: vi
          .fn()
          .mockImplementation(() => Promise.resolve(JSON.parse(JSON.stringify(rawDoc)))),
      };

      (mutStore as unknown as { collection: typeof mockCollection }).collection = mockCollection;

      // 1. findOneAndUpdate by default hides secret & audit.createdBy
      const doc1 = await mutStore.findOneAndUpdate(
        { title: 'Project Alpha' },
        { $set: { title: 'Updated' } }
      );
      expect(doc1?.title).toBe('Project Alpha');
      expect((doc1 as any)?.secret).toBeUndefined();
      expect((doc1 as any)?.audit?.createdBy).toBeUndefined();

      // 2. findOneAndUpdate with select un-hides secret
      const doc2 = await mutStore.findOneAndUpdate(
        { title: 'Project Alpha' },
        { $set: { title: 'Updated' } },
        { select: ['secret'] }
      );
      expect(doc2?.secret).toBe('shhh');
      expect((doc2 as any)?.audit?.createdBy).toBeUndefined();

      // 3. findOneAndUpsert by default hides secret inside UpsertResult doc
      mockCollection.findOneAndUpdate.mockResolvedValueOnce({
        value: JSON.parse(JSON.stringify(rawDoc)),
        lastErrorObject: { upserted: new ObjectId() },
      });
      const upsertRes1 = await mutStore.findOneAndUpsert(
        { title: 'Project Alpha' },
        { $setOnInsert: { title: 'Project Alpha', secret: 'shhh' } }
      );
      expect(upsertRes1.isNew).toBe(true);
      expect(upsertRes1.doc?.title).toBe('Project Alpha');
      expect((upsertRes1.doc as any)?.secret).toBeUndefined();

      // 4. findOneAndUpsert with select un-hides secret inside UpsertResult doc
      mockCollection.findOneAndUpdate.mockResolvedValueOnce({
        value: JSON.parse(JSON.stringify(rawDoc)),
        lastErrorObject: { upserted: new ObjectId() },
      });
      const upsertRes2 = await mutStore.findOneAndUpsert(
        { title: 'Project Alpha' },
        { $setOnInsert: { title: 'Project Alpha', secret: 'shhh' } },
        { select: ['secret'] }
      );
      expect(upsertRes2.doc?.secret).toBe('shhh');

      // 5. findOneAndDelete with select un-hides secret
      const deletedDoc = await mutStore.findOneAndDelete(
        { title: 'Project Alpha' },
        { select: ['secret'] }
      );
      expect(deletedDoc?.secret).toBe('shhh');

      // 6. findOneAndReplace with select un-hides secret
      const replacedDoc = await mutStore.findOneAndReplace(
        { title: 'Project Alpha' },
        { title: 'Project Alpha', secret: 'shhh', audit: { createdBy: 'admin' } },
        { select: ['secret'] }
      );
      expect(replacedDoc?.secret).toBe('shhh');
    });

    it('should hide private fields by default on requireById and requireOne, and un-hide only when select is passed', async () => {
      const store = new Store('reqTest', {
        schema: {
          title: schema.string(),
          secret: schema.string().private(),
        },
        indexes: [],
      });

      const rawDoc = { _id: new ObjectId(), title: 'Test', secret: 'hidden_val' };
      const mockCol = {
        findOne: vi
          .fn()
          .mockImplementation(() => Promise.resolve(JSON.parse(JSON.stringify(rawDoc)))),
      };
      (store as unknown as { collection: typeof mockCol }).collection = mockCol;

      // 1. requireById & requireOne without options: secret is HIDDEN by default
      const defaultDocById = await store.requireById(rawDoc._id);
      expect(defaultDocById.title).toBe('Test');
      expect((defaultDocById as any).secret).toBeUndefined();

      const defaultDocByOne = await store.requireOne({ title: 'Test' });
      expect(defaultDocByOne.title).toBe('Test');
      expect((defaultDocByOne as any).secret).toBeUndefined();

      // 2. requireById & requireOne with select option: secret is UN-HIDDEN
      const selectedDocById = await store.requireById(rawDoc._id, { select: ['secret'] });
      expect(selectedDocById.secret).toBe('hidden_val');

      const selectedDocByOne = await store.requireOne({ title: 'Test' }, { select: ['secret'] });
      expect(selectedDocByOne.secret).toBe('hidden_val');
    });
  });

  describe('requireById and requireOne custom error handler support', () => {
    class CustomNotFoundError extends Error {
      constructor(msg: string) {
        super(msg);
        this.name = 'CustomNotFoundError';
      }
    }

    it('should invoke custom errorHandler when passed as 2nd argument', async () => {
      const store = new Store('test', { schema: { name: schema.string() }, indexes: [] });
      const mockCol = {
        findOne: vi.fn().mockResolvedValue(null),
      };
      (store as unknown as { collection: typeof mockCol }).collection = mockCol;

      const id = new ObjectId();

      // requireById with errorHandler as 2nd arg
      await expect(
        store.requireById(id, () => new CustomNotFoundError('Custom ID error'))
      ).rejects.toThrow(CustomNotFoundError);

      // requireOne with errorHandler as 2nd arg
      await expect(
        store.requireOne({ name: 'missing' }, () => new CustomNotFoundError('Custom query error'))
      ).rejects.toThrow(CustomNotFoundError);
    });

    it('should invoke custom errorHandler when passed as 3rd argument with options', async () => {
      const store = new Store('test', { schema: { name: schema.string() }, indexes: [] });
      const mockCol = {
        findOne: vi.fn().mockResolvedValue(null),
      };
      (store as unknown as { collection: typeof mockCol }).collection = mockCol;

      const id = new ObjectId();

      // requireById with options and errorHandler
      await expect(
        store.requireById(id, {}, () => new CustomNotFoundError('Custom ID error with options'))
      ).rejects.toThrow(CustomNotFoundError);

      // requireOne with options and errorHandler
      await expect(
        store.requireOne(
          { name: 'missing' },
          {},
          () => new CustomNotFoundError('Custom query error with options')
        )
      ).rejects.toThrow(CustomNotFoundError);
    });
  });
});
