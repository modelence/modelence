import { Document, IndexDescription, SearchIndexDescription } from 'mongodb';

import { Store, getComparableIndexOptions, IndexCreationMode } from './store';

export type MergedStoreMetadata = {
  name: string;
  schema: Record<string, unknown>;
  indexes: IndexDescription[];
  searchIndexes: SearchIndexDescription[];
  indexCreationMode: IndexCreationMode;
};

/**
 * Serialize an IndexDescription to a stable string for dedup / conflict detection.
 * Two indexes are "equivalent" when their key + comparable options are deeply equal.
 */
const serializeIndex = (index: IndexDescription): string => {
  const keyPart = JSON.stringify(index.key);
  const optsPart = JSON.stringify(getComparableIndexOptions(index));
  return `${index.name}|${keyPart}|${optsPart}`;
};

const serializeSearchIndex = (si: SearchIndexDescription): string => {
  return JSON.stringify({ name: si.name, type: (si as Document).type, definition: si.definition });
};

/**
 * Groups stores by collection name and merges their metadata.
 *
 * - Schema fields are unioned by key; identical serialized definitions are
 *   deduped, mismatched definitions throw.
 * - Indexes and search indexes are deduped by serialized form; same-name but
 *   different-definition conflicts throw.
 * - indexCreationMode resolves to 'blocking' if *any* contributor is blocking.
 *
 * @internal
 */
export function mergeStoresByName(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  stores: Store<any, any>[]
): MergedStoreMetadata[] {
  const groups = new Map<
    string,
    {
      schema: Record<string, unknown>;
      indexes: Map<string, IndexDescription>; // keyed by name
      indexSerialized: Map<string, string>; // name -> serialized form
      searchIndexes: Map<string, SearchIndexDescription>; // keyed by name
      searchSerialized: Map<string, string>; // name -> serialized form
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
        indexSerialized: new Map(),
        searchIndexes: new Map(),
        searchSerialized: new Map(),
        indexCreationMode: 'background',
      };
      groups.set(name, group);
    }

    // Merge schema
    const storeSchema = store.getSchema() as Record<string, unknown>;
    for (const [field, def] of Object.entries(storeSchema)) {
      const existing = group.schema[field];
      if (existing !== undefined) {
        const existingSerialized = JSON.stringify(existing);
        const newSerialized = JSON.stringify(def);
        if (existingSerialized !== newSerialized) {
          throw new Error(
            `Conflicting schema field '${field}' in collection '${name}': ` +
              `definitions do not match across stores`
          );
        }
      } else {
        group.schema[field] = def;
      }
    }

    // Merge indexes
    for (const index of store.getIndexes()) {
      const indexName = index.name;
      if (!indexName) continue;

      const serialized = serializeIndex(index);
      const existingSerialized = group.indexSerialized.get(indexName);

      if (existingSerialized !== undefined) {
        if (existingSerialized !== serialized) {
          throw new Error(
            `Conflicting index '${indexName}' in collection '${name}': ` +
              `definitions do not match across stores`
          );
        }
      } else {
        group.indexes.set(indexName, index);
        group.indexSerialized.set(indexName, serialized);
      }
    }

    // Merge search indexes
    for (const si of store.getSearchIndexes()) {
      const siName = si.name;
      if (!siName) continue;

      const serialized = serializeSearchIndex(si);
      const existingSerialized = group.searchSerialized.get(siName);

      if (existingSerialized !== undefined) {
        if (existingSerialized !== serialized) {
          throw new Error(
            `Conflicting search index '${siName}' in collection '${name}': ` +
              `definitions do not match across stores`
          );
        }
      } else {
        group.searchIndexes.set(siName, si);
        group.searchSerialized.set(siName, serialized);
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
