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
}) {
  return new Store<ModelSchema, Record<string, never>>('testCollection', {
    schema: baseSchema,
    indexes: options?.indexes || [],
    searchIndexes: options?.searchIndexes,
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
    expect((extended as unknown as { indexes: IndexDescription[] }).indexes.length).toBe(2);

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

  test('createIndexes retries after duplicate index errors', async () => {
    const store = createStore({
      indexes: [{ key: { name: 1 }, name: 'nameIdx' }],
      searchIndexes: [{ name: 'searchIdx', definition: {} } as SearchIndexDescription],
    });

    const indexError = new MongoError(
      'An existing index has the same name as the requested index. Requested index: { v: 2, key: { name: 1 }, name: "nameIdx" }, existing index: { v: 2, key: { name: 1 }, name: "nameIdx" }'
    ) as MongoError & { code: number };
    indexError.code = 86;
    const searchError = new MongoError('duplicate search') as MongoError & { code: number };
    searchError.code = 68;

    const collectionMock = {
      createIndexes: jest
        .fn()
        .mockRejectedValueOnce(indexError as never)
        .mockResolvedValueOnce(undefined as never),
      dropIndex: jest.fn().mockResolvedValue(undefined as never),
      createSearchIndexes: jest
        .fn()
        .mockRejectedValueOnce(searchError as never)
        .mockResolvedValueOnce(undefined as never),
      dropSearchIndex: jest.fn().mockResolvedValue(undefined as never),
    };

    (store as unknown as { collection: typeof collectionMock }).collection = collectionMock;

    await store.createIndexes();

    expect(collectionMock.createIndexes).toHaveBeenCalledTimes(2);
    expect(collectionMock.dropIndex).toHaveBeenCalledWith('nameIdx');
    expect(collectionMock.createSearchIndexes).toHaveBeenCalledTimes(2);
    expect(collectionMock.dropSearchIndex).toHaveBeenCalledWith('searchIdx');
  });

  test('createIndexes drops auto-named indexes when options change', async () => {
    const store = createStore({
      indexes: [{ key: { title: 1, completed: 1 }, unique: true }],
    });

    const indexError = new MongoError(
      'An existing index has the same name as the requested index. Requested index: { v: 2, unique: true, key: { title: 1, completed: 1 }, name: "title_1_completed_1" }, existing index: { v: 2, key: { title: 1, completed: 1 }, name: "title_1_completed_1" }'
    ) as MongoError & { code: number };
    indexError.code = 86;

    const collectionMock = {
      createIndexes: jest
        .fn()
        .mockRejectedValueOnce(indexError as never)
        .mockResolvedValueOnce(undefined as never),
      dropIndex: jest.fn().mockResolvedValue(undefined as never),
    };

    (store as unknown as { collection: typeof collectionMock }).collection = collectionMock;

    await store.createIndexes();

    expect(collectionMock.dropIndex).toHaveBeenCalledWith('title_1_completed_1');
    expect(collectionMock.createIndexes).toHaveBeenCalledTimes(2);
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
