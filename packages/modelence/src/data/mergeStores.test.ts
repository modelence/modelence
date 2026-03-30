import { describe, expect, test } from '@jest/globals';
import { IndexDescription, SearchIndexDescription } from 'mongodb';

import { Store } from './store';
import type { ModelSchema } from './types';
import { mergeStoresByName } from './mergeStores';

const baseSchema = {
  name: {},
} as ModelSchema;

function createStore(
  collectionName: string,
  options?: {
    schema?: ModelSchema;
    indexes?: IndexDescription[];
    searchIndexes?: SearchIndexDescription[];
    indexCreationMode?: 'blocking' | 'background';
  }
) {
  return new Store<ModelSchema, Record<string, never>>(collectionName, {
    schema: options?.schema ?? baseSchema,
    indexes: options?.indexes ?? [],
    searchIndexes: options?.searchIndexes,
    indexCreationMode: options?.indexCreationMode,
  });
}

describe('data/mergeStores', () => {
  test('merges same-name stores and unions schema, indexes, and search indexes', () => {
    const storeA = createStore('users', {
      schema: { name: {} } as ModelSchema,
      indexes: [{ key: { name: 1 } }],
    });
    const storeB = createStore('users', {
      schema: { age: {} } as ModelSchema,
      indexes: [{ key: { age: -1 } }],
      searchIndexes: [{ name: 'searchIdx', definition: {} } as SearchIndexDescription],
    });

    const result = mergeStoresByName([storeA, storeB]);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('users');
    expect(result[0].schema).toMatchObject({
      name: expect.anything(),
      age: expect.anything(),
    });
    expect(result[0].indexes).toHaveLength(2);
    expect(result[0].searchIndexes).toHaveLength(1);
  });

  test('deduplicates equivalent schema field definitions', () => {
    const sharedSchema = { name: {} } as ModelSchema;
    const storeA = createStore('users', { schema: sharedSchema });
    const storeB = createStore('users', { schema: sharedSchema });

    const result = mergeStoresByName([storeA, storeB]);

    expect(result).toHaveLength(1);
    expect(Object.keys(result[0].schema)).toEqual(['name']);
  });

  test('deduplicates equivalent index definitions', () => {
    const indexes: IndexDescription[] = [{ key: { name: 1 }, unique: true }];
    const storeA = createStore('users', { indexes });
    const storeB = createStore('users', { indexes });

    const result = mergeStoresByName([storeA, storeB]);

    expect(result).toHaveLength(1);
    expect(result[0].indexes).toHaveLength(1);
  });

  test('deduplicates equivalent search index definitions', () => {
    const searchIndexes = [
      { name: 'search', definition: { mappings: {} } } as SearchIndexDescription,
    ];
    const storeA = createStore('users', { searchIndexes });
    const storeB = createStore('users', { searchIndexes });

    const result = mergeStoresByName([storeA, storeB]);

    expect(result).toHaveLength(1);
    expect(result[0].searchIndexes).toHaveLength(1);
  });

  test('throws on conflicting schema field definitions', () => {
    const storeA = createStore('users', {
      schema: { name: { type: 'string' } } as unknown as ModelSchema,
    });
    const storeB = createStore('users', {
      schema: { name: { type: 'number' } } as unknown as ModelSchema,
    });

    expect(() => mergeStoresByName([storeA, storeB])).toThrow(
      "Conflicting schema field 'name' in collection 'users': definitions do not match across stores"
    );
  });

  test('throws on conflicting index definitions with same name', () => {
    const storeA = createStore('users', {
      indexes: [{ key: { name: 1 }, name: 'nameIdx' }],
    });
    const storeB = createStore('users', {
      indexes: [{ key: { name: -1 }, name: 'nameIdx' }],
    });

    expect(() => mergeStoresByName([storeA, storeB])).toThrow(
      "Conflicting index '_modelence_nameIdx' in collection 'users': definitions do not match across stores"
    );
  });

  test('throws on conflicting search index definitions with same name', () => {
    const storeA = createStore('users', {
      searchIndexes: [
        { name: 'search', definition: { mappings: { a: 1 } } } as SearchIndexDescription,
      ],
    });
    const storeB = createStore('users', {
      searchIndexes: [
        { name: 'search', definition: { mappings: { b: 2 } } } as SearchIndexDescription,
      ],
    });

    expect(() => mergeStoresByName([storeA, storeB])).toThrow(
      "Conflicting search index 'search' in collection 'users': definitions do not match across stores"
    );
  });

  test('resolves indexCreationMode to blocking if any contributor is blocking', () => {
    const storeA = createStore('users', { indexCreationMode: 'background' });
    const storeB = createStore('users', { indexCreationMode: 'blocking' });

    const result = mergeStoresByName([storeA, storeB]);

    expect(result).toHaveLength(1);
    expect(result[0].indexCreationMode).toBe('blocking');
  });

  test('resolves indexCreationMode to background when all are background', () => {
    const storeA = createStore('users', { indexCreationMode: 'background' });
    const storeB = createStore('users', { indexCreationMode: 'background' });

    const result = mergeStoresByName([storeA, storeB]);

    expect(result[0].indexCreationMode).toBe('background');
  });

  test('keeps distinct collections separate', () => {
    const storeA = createStore('users', {
      schema: { name: {} } as ModelSchema,
    });
    const storeB = createStore('sessions', {
      schema: { token: {} } as ModelSchema,
    });

    const result = mergeStoresByName([storeA, storeB]);

    expect(result).toHaveLength(2);
    expect(result.map((r) => r.name).sort()).toEqual(['sessions', 'users']);
  });

  test('returns empty array for empty input', () => {
    expect(mergeStoresByName([])).toEqual([]);
  });

  test('handles single store without merging', () => {
    const store = createStore('users', {
      schema: { name: {} } as ModelSchema,
      indexes: [{ key: { name: 1 } }],
      indexCreationMode: 'blocking',
    });

    const result = mergeStoresByName([store]);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('users');
    expect(result[0].indexes).toHaveLength(1);
    expect(result[0].indexCreationMode).toBe('blocking');
  });
});
