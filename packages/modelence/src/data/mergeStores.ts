import { isDeepStrictEqual } from 'node:util';

import { IndexDescription, SearchIndexDescription } from 'mongodb';

import { Store, isSameIndexDefinition, IndexCreationMode } from './store';
import { ModelSchema } from './types';

export type MergedStoreMetadata = {
  name: string;
  schema: Record<string, unknown>;
  indexes: IndexDescription[];
  searchIndexes: SearchIndexDescription[];
  indexCreationMode: IndexCreationMode;
};

/**
 * Groups stores by collection name and merges their metadata.
 *
 * - Schema fields are unioned by key; identical serialized definitions are
 *   deduped, mismatched definitions throw.
 * - Indexes and search indexes are deduped; same-name but
 *   different-definition conflicts throw.
 * - indexCreationMode resolves to 'blocking' if *any* contributor is blocking.
 *
 * @internal
 */
export function mergeStoresByName(
  stores: Store<ModelSchema, Record<string, never>>[]
): MergedStoreMetadata[] {
  const groups = new Map<
    string,
    {
      schema: Record<string, unknown>;
      indexes: Map<string, IndexDescription>;
      searchIndexes: Map<string, SearchIndexDescription>;
      indexCreationMode: IndexCreationMode;
    }
  >();

  for (const store of stores) {
    const name = store.getName();
    let group = groups.get(name);

    if (!group) {
      group = {
        schema: {},
        indexes: new Map(),
        searchIndexes: new Map(),
        indexCreationMode: 'background',
      };
      groups.set(name, group);
    }

    // Merge schema
    const storeSchema = store.getSchema() as Record<string, unknown>;
    for (const [field, def] of Object.entries(storeSchema)) {
      const existing = group.schema[field];
      if (existing !== undefined) {
        if (!isDeepStrictEqual(existing, def)) {
          throw new Error(
            `Conflicting schema field '${field}' in collection '${name}': ` +
              `definitions do not match across stores`
          );
        }
      } else {
        group.schema[field] = def;
      }
    }

    // Merge indexes (reuses store.ts isSameIndexDefinition)
    for (const index of store.getIndexes()) {
      const indexName = index.name;
      if (!indexName) continue;

      const existing = group.indexes.get(indexName);
      if (existing) {
        if (!isSameIndexDefinition(existing, index)) {
          throw new Error(
            `Conflicting index '${indexName}' in collection '${name}': ` +
              `definitions do not match across stores`
          );
        }
      } else {
        group.indexes.set(indexName, index);
      }
    }

    // Merge search indexes
    for (const si of store.getSearchIndexes()) {
      const siName = si.name;
      if (!siName) continue;

      const existing = group.searchIndexes.get(siName);
      if (existing) {
        if (!isDeepStrictEqual(existing, si)) {
          throw new Error(
            `Conflicting search index '${siName}' in collection '${name}': ` +
              `definitions do not match across stores`
          );
        }
      } else {
        group.searchIndexes.set(siName, si);
      }
    }

    // Merge indexCreationMode - blocking wins
    if (store.getIndexCreationMode() === 'blocking') {
      group.indexCreationMode = 'blocking';
    }
  }

  const result: MergedStoreMetadata[] = [];
  for (const [name, group] of groups) {
    result.push({
      name,
      schema: group.schema,
      indexes: [...group.indexes.values()],
      searchIndexes: [...group.searchIndexes.values()],
      indexCreationMode: group.indexCreationMode,
    });
  }

  return result;
}
