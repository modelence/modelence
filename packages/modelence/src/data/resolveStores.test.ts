import { describe, expect, test } from '@jest/globals';
import { IndexDescription, SearchIndexDescription } from 'mongodb';

import { Store } from './store';
import type { ModelSchema } from './types';
import { resolveStores, toEffectiveStoreMetadata } from './resolveStores';

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

describe('data/resolveStores', () => {
  test('deduplicates identical store instances', () => {
    const store = createStore('users');

    const { storesToInit, effectiveStores } = resolveStores([store, store, store]);

    expect(storesToInit).toHaveLength(1);
    expect(storesToInit[0]).toBe(store);
    expect(effectiveStores).toHaveLength(1);
    expect(effectiveStores[0]).toBe(store);
  });

  test('resolves chain tail as effective store', () => {
    const base = createStore('users');
    const extended = base.extend({ schema: { age: {} } as ModelSchema });

    const { storesToInit, effectiveStores } = resolveStores([base, extended]);

    expect(storesToInit).toHaveLength(2);
    expect(effectiveStores).toHaveLength(1);
    expect(effectiveStores[0]).toBe(extended);
  });

  test('resolves tail even when only base is registered', () => {
    const base = createStore('users');
    const extended = base.extend({ schema: { age: {} } as ModelSchema });

    // Only base is registered in a module, but tail should still resolve
    const { storesToInit, effectiveStores } = resolveStores([base]);

    expect(storesToInit).toHaveLength(1);
    expect(storesToInit[0]).toBe(base);
    expect(effectiveStores).toHaveLength(1);
    expect(effectiveStores[0]).toBe(extended);
  });

  test('resolves multiple independent chains', () => {
    const users = createStore('users');
    const extendedUsers = users.extend({ schema: { age: {} } as ModelSchema });
    const sessions = createStore('sessions');

    const { storesToInit, effectiveStores } = resolveStores([users, extendedUsers, sessions]);

    expect(storesToInit).toHaveLength(3);
    expect(effectiveStores).toHaveLength(2);
    expect(effectiveStores).toContain(extendedUsers);
    expect(effectiveStores).toContain(sessions);
  });

  test('throws on unrelated stores with same collection name', () => {
    const storeA = createStore('users');
    const storeB = createStore('users');

    expect(() => resolveStores([storeA, storeB])).toThrow(
      "Store collision: multiple unrelated stores use collection name 'users'. " +
        'Use .extend() to create a single extension chain instead of independent stores.'
    );
  });

  test('allows same-name stores that are in the same chain', () => {
    const base = createStore('users');
    const extended = base.extend({ schema: { age: {} } as ModelSchema });

    // Both are in the same chain, should not throw
    expect(() => resolveStores([base, extended])).not.toThrow();
  });

  test('returns empty arrays for empty input', () => {
    const { storesToInit, effectiveStores } = resolveStores([]);

    expect(storesToInit).toEqual([]);
    expect(effectiveStores).toEqual([]);
  });

  test('handles single store without extension', () => {
    const store = createStore('users', {
      indexes: [{ key: { name: 1 } }],
      indexCreationMode: 'blocking',
    });

    const { storesToInit, effectiveStores } = resolveStores([store]);

    expect(storesToInit).toHaveLength(1);
    expect(effectiveStores).toHaveLength(1);
    expect(effectiveStores[0]).toBe(store);
  });
});

describe('toEffectiveStoreMetadata', () => {
  test('converts stores to metadata format', () => {
    const store = createStore('users', {
      schema: { name: {} } as ModelSchema,
      indexes: [{ key: { name: 1 } }],
      searchIndexes: [{ name: 'searchIdx', definition: {} } as SearchIndexDescription],
      indexCreationMode: 'blocking',
    });

    const metadata = toEffectiveStoreMetadata([store]);

    expect(metadata).toHaveLength(1);
    expect(metadata[0].name).toBe('users');
    expect(metadata[0].schema).toMatchObject({ name: expect.anything() });
    expect(metadata[0].indexes).toHaveLength(1);
    expect(metadata[0].searchIndexes).toHaveLength(1);
    expect(metadata[0].indexCreationMode).toBe('blocking');
  });
});
