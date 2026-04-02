import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { IndexDescription, MongoError, ObjectId, SearchIndexDescription } from 'mongodb';

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

  typedStore.fetch(
    { name: 'john' },
    {
      sort: { name: 1, score: -1, 'nested.level': 1 },
      projection: { name: 1, score: 1, 'nested.level': 1 },
    }
  );

  // @ts-expect-error unknown top-level field should be rejected in sort
  typedStore.fetch({ name: 'john' }, { sort: { unknownField: 1 } });
  // @ts-expect-error unknown top-level field should be rejected in projection
  typedStore.fetch({ name: 'john' }, { projection: { unknownField: 1 } });
}
void assertFetchOptionTypeSafety;

describe('data/store', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
      listIndexes: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([
          { name: '_id_', key: { _id: 1 } },
          // Same name, but stale options (missing unique) - should be replaced by code definition
          { name: '_modelence_nameIdx', key: { name: 1 } },
        ] as never),
      }),
      createIndexes: jest.fn().mockResolvedValue(undefined as never),
      dropIndex: jest.fn().mockResolvedValue(undefined as never),
      createSearchIndexes: jest
        .fn()
        .mockRejectedValueOnce(searchError as never)
        .mockResolvedValueOnce(undefined as never),
      dropSearchIndex: jest.fn().mockResolvedValue(undefined as never),
    };

    (store as unknown as { collection: typeof collectionMock }).collection = collectionMock;

    await store.createIndexes();

    expect(collectionMock.listIndexes).toHaveBeenCalled();
    expect(collectionMock.createIndexes).toHaveBeenCalledTimes(1);
    expect(collectionMock.dropIndex).toHaveBeenCalledWith('_modelence_nameIdx');
    expect(collectionMock.createSearchIndexes).toHaveBeenCalledTimes(2);
    expect(collectionMock.dropSearchIndex).toHaveBeenCalledWith('searchIdx');
  });

  test('createIndexes drops auto-named indexes when options change', async () => {
    const store = createStore({
      indexes: [{ key: { title: 1, completed: 1 }, unique: true }],
    });

    const collectionMock = {
      listIndexes: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([
          { name: '_id_', key: { _id: 1 } },
          { name: '_modelence_title_1_completed_1', key: { title: 1, completed: 1 } },
        ] as never),
      }),
      createIndexes: jest.fn().mockResolvedValue(undefined as never),
      dropIndex: jest.fn().mockResolvedValue(undefined as never),
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
      listIndexes: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([
          { name: '_id_', key: { _id: 1 } },
          {
            name: 'environmentId_1_chatId_1_position_1',
            key: { environmentId: 1, chatId: 1, position: 1 },
          },
        ] as never),
      }),
      createIndexes: jest.fn().mockResolvedValue(undefined as never),
      dropIndex: jest.fn().mockResolvedValue(undefined as never),
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
      listIndexes: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([
          { name: '_id_', key: { _id: 1 } }, // Default index, should not be dropped
          { name: '_modelence_name_1', key: { name: 1 } }, // Current index, should be kept
          { name: '_modelence_oldField_1', key: { oldField: 1 } }, // Orphaned index, should be dropped
          { name: 'customIndex_1', key: { customField: 1 } }, // Non-modelence index, should not be dropped
        ] as never),
      }),
      createIndexes: jest.fn().mockResolvedValue(undefined as never),
      dropIndex: jest.fn().mockResolvedValue(undefined as never),
    };

    (store as unknown as { collection: typeof collectionMock }).collection = collectionMock;

    await store.createIndexes();

    // Should only drop the orphaned _modelence_ index
    expect(collectionMock.dropIndex).toHaveBeenCalledTimes(1);
    expect(collectionMock.dropIndex).toHaveBeenCalledWith('_modelence_oldField_1');
    expect(collectionMock.createIndexes).not.toHaveBeenCalled();
  });

  test('createIndexes handles non-existent collection (code 26)', async () => {
    const store = createStore({
      indexes: [{ key: { name: 1 } }],
    });

    const namespaceError = new MongoError('ns not found') as MongoError & { code: number };
    namespaceError.code = 26;

    const collectionMock = {
      listIndexes: jest.fn().mockReturnValue({
        toArray: jest.fn().mockRejectedValue(namespaceError as never),
      }),
      createIndexes: jest.fn().mockResolvedValue(undefined as never),
      dropIndex: jest.fn().mockResolvedValue(undefined as never),
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
      listIndexes: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([
          { name: '_id_', key: { _id: 1 } },
          // Conflicting manual index with same key should be dropped, but race may already remove it
          { name: 'handle_1', key: { handle: 1 } },
        ] as never),
      }),
      createIndexes: jest.fn().mockResolvedValue(undefined as never),
      dropIndex: jest.fn().mockRejectedValue(indexNotFoundError as never),
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
    expect(base.isInSameChain(top)).toBe(true);
    expect(mid.isInSameChain(base)).toBe(true);
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

  test('isInSameChain returns false for unrelated stores', () => {
    const storeA = createStore();
    const storeB = new Store<ModelSchema, Record<string, never>>('otherCollection', {
      schema: { foo: {} } as ModelSchema,
      indexes: [],
      methods: undefined,
    });
    expect(storeA.isInSameChain(storeB)).toBe(false);
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
      updateOne: jest.fn().mockResolvedValue(undefined as never),
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
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      toArray: jest.fn().mockResolvedValue([{ _id: new ObjectId(), name: 'test' }] as never),
    };
    const collectionMock = {
      find: jest.fn().mockReturnValue(cursorMock as never),
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

  test('vectorSearch delegates to aggregate with expected pipeline', async () => {
    const store = createStore();
    const aggregateSpy = jest
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
        insertOne: jest.fn().mockResolvedValue({ insertedId: new ObjectId() } as never),
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
        insertMany: jest.fn().mockResolvedValue({ insertedCount: 1 } as never),
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
        updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 } as never),
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
        updateOne: jest.fn().mockResolvedValue({ upsertedCount: 1 } as never),
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
        deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 } as never),
      };
      (store as unknown as { collection: typeof collectionMock }).collection = collectionMock;

      const session = {} as never;
      await store.deleteOne({ name: 'test' } as never, { session });

      expect(collectionMock.deleteOne).toHaveBeenCalledWith({ name: 'test' }, { session });
    });

    test('deleteMany forwards session option to MongoDB', async () => {
      const store = createStore();
      const collectionMock = {
        deleteMany: jest.fn().mockResolvedValue({ deletedCount: 2 } as never),
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
        findOneAndUpdate: jest.fn().mockResolvedValue(doc as never),
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
        findOneAndUpdate: jest.fn().mockResolvedValue(null as never),
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
        findOneAndUpdate: jest.fn().mockResolvedValue(null as never),
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
        findOneAndUpdate: jest.fn().mockResolvedValue(null as never),
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
        findOneAndDelete: jest.fn().mockResolvedValue(doc as never),
      };
      (store as unknown as { collection: typeof collectionMock }).collection = collectionMock;

      const result = await store.findOneAndDelete({ name: 'deleted' } as never);

      expect(collectionMock.findOneAndDelete).toHaveBeenCalledWith({ name: 'deleted' }, {});
      expect(result).toMatchObject({ name: 'deleted' });
    });

    test('returns null when document not found', async () => {
      const store = createStore();
      const collectionMock = {
        findOneAndDelete: jest.fn().mockResolvedValue(null as never),
      };
      (store as unknown as { collection: typeof collectionMock }).collection = collectionMock;

      const result = await store.findOneAndDelete({ name: 'missing' } as never);

      expect(result).toBeNull();
    });

    test('converts string selector to ObjectId', async () => {
      const store = createStore();
      const id = '507f1f77bcf86cd799439011';
      const collectionMock = {
        findOneAndDelete: jest.fn().mockResolvedValue(null as never),
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
        findOneAndReplace: jest.fn().mockResolvedValue(doc as never),
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
        findOneAndReplace: jest.fn().mockResolvedValue(null as never),
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
        replaceOne: jest.fn().mockResolvedValue({ modifiedCount: 1 } as never),
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
        replaceOne: jest.fn().mockResolvedValue({ modifiedCount: 1 } as never),
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
        replaceOne: jest.fn().mockResolvedValue({ upsertedCount: 1 } as never),
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
        distinct: jest.fn().mockResolvedValue(['alice', 'bob'] as never),
      };
      (store as unknown as { collection: typeof collectionMock }).collection = collectionMock;

      const result = await store.distinct('name');

      expect(collectionMock.distinct).toHaveBeenCalledWith('name', {});
      expect(result).toEqual(['alice', 'bob']);
    });

    test('passes filter to MongoDB', async () => {
      const store = createStore();
      const collectionMock = {
        distinct: jest.fn().mockResolvedValue(['alice'] as never),
      };
      (store as unknown as { collection: typeof collectionMock }).collection = collectionMock;

      await store.distinct('name', { name: 'alice' } as never);

      expect(collectionMock.distinct).toHaveBeenCalledWith('name', { name: 'alice' });
    });

    test('passes options to MongoDB when provided', async () => {
      const store = createStore();
      const collectionMock = {
        distinct: jest.fn().mockResolvedValue([] as never),
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
      const changeStream = { on: jest.fn() };
      const collectionMock = {
        watch: jest.fn().mockReturnValue(changeStream as never),
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
        watch: jest.fn().mockReturnValue(changeStream as never),
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
        findOne: jest.fn().mockResolvedValue({ _id: new ObjectId(), name: 'test' } as never),
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
        findOne: jest.fn().mockResolvedValue({ _id: new ObjectId(), name: 'test' } as never),
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
        findOne: jest.fn().mockResolvedValue({ _id: new ObjectId(), name: 'test' } as never),
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
        findOne: jest.fn().mockResolvedValue({ _id: new ObjectId(), name: 'test' } as never),
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
        findOne: jest.fn().mockResolvedValue({ _id: new ObjectId(), name: 'test' } as never),
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
        findOne: jest.fn().mockResolvedValue({ _id: new ObjectId(), name: 'test' } as never),
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
        findOne: jest.fn().mockResolvedValue({ _id: new ObjectId(), name: 'test' } as never),
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
        findOne: jest.fn().mockResolvedValue({ _id: new ObjectId(), name: 'test' } as never),
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
        findOne: jest.fn().mockResolvedValue({ _id: new ObjectId(), name: 'test' } as never),
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
        findOne: jest.fn().mockResolvedValue({ _id: new ObjectId(), name: 'test' } as never),
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
        findOne: jest.fn().mockResolvedValue({ _id: new ObjectId(), name: 'test' } as never),
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
        findOne: jest.fn().mockResolvedValue({ _id: new ObjectId(), name: 'test' } as never),
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
        findOne: jest.fn().mockResolvedValue({ _id: new ObjectId(), name: 'test' } as never),
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
});
