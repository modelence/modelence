import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { IndexDescription, MongoError, ObjectId, SearchIndexDescription } from 'mongodb';

import { Store } from './store';
import type { ModelSchema } from './types';

const baseSchema = {
  name: {},
} as ModelSchema;

function createStore(options?: {
  indexes?: IndexDescription[];
  searchIndexes?: SearchIndexDescription[];
  indexCreationMode?: 'blocking' | 'background';
  deduplicateIndexes?: (store: {
    deduplicateByFields(params: {
      fields: string[];
      sortBy: Record<string, unknown>;
    }): Promise<number>;
  }) => Promise<number> | number;
}) {
  return new Store<ModelSchema, Record<string, never>>('testCollection', {
    schema: baseSchema,
    indexes: options?.indexes || [],
    searchIndexes: options?.searchIndexes,
    indexCreationMode: options?.indexCreationMode,
    deduplicateIndexes: options?.deduplicateIndexes,
    methods: undefined,
  });
}

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

  test('deduplicateByFields keeps first sorted doc per group and deletes the rest', async () => {
    const store = createStore();
    const collectionMock = {
      aggregate: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([
          {
            _id: 'job',
            ids: [
              new ObjectId('507f1f77bcf86cd799439011'),
              new ObjectId('507f1f77bcf86cd799439012'),
            ],
            count: 2,
          },
        ] as never),
      }),
      deleteMany: jest.fn().mockResolvedValue({ deletedCount: 1 } as never),
    };

    (store as unknown as { collection: typeof collectionMock }).collection = collectionMock;

    const deletedCount = await store.deduplicateByFields({
      fields: ['name'],
      sortBy: { name: 1, _id: -1 },
    });

    expect(collectionMock.aggregate).toHaveBeenCalledWith([
      { $sort: { name: 1, _id: -1 } },
      { $group: { _id: '$name', ids: { $push: '$_id' }, count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
    ]);
    expect(collectionMock.deleteMany).toHaveBeenCalledWith({
      _id: { $in: [new ObjectId('507f1f77bcf86cd799439012')] },
    });
    expect(deletedCount).toBe(1);
  });

  test('deduplicateOnIndexConflict returns null when deduplicator is not configured', async () => {
    const store = createStore();

    const deletedCount = await store.deduplicateOnIndexConflict();

    expect(deletedCount).toBeNull();
  });

  test('deduplicateOnIndexConflict runs configured deduplicator when present', async () => {
    const deduplicateIndexes = jest.fn(
      async (_store: {
        deduplicateByFields: (params: {
          fields: string[];
          sortBy: Record<string, unknown>;
        }) => Promise<number>;
      }) => 3
    );
    const store = createStore({ deduplicateIndexes });

    const deletedCount = await store.deduplicateOnIndexConflict();

    expect(deduplicateIndexes).toHaveBeenCalledTimes(1);
    const passedStore = deduplicateIndexes.mock.calls[0]?.[0];
    expect(passedStore).toEqual(
      expect.objectContaining({ deduplicateByFields: expect.any(Function) })
    );
    expect(deletedCount).toBe(3);
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
