import { IndexDescription, SearchIndexDescription } from 'mongodb';

import { Store, IndexCreationMode } from './store';
import { ModelSchema } from './types';

/**
 * Type-erased Store reference – see store.ts AnyStore for rationale.
 * @internal
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyStore = Store<any, any>;

export type EffectiveStoreMetadata = {
  name: string;
  schema: Record<string, unknown>;
  indexes: IndexDescription[];
  searchIndexes: SearchIndexDescription[];
  indexCreationMode: IndexCreationMode;
};

export type ResolvedStores = {
  storesToInit: Store<ModelSchema, Record<string, never>>[];
  effectiveStores: Store<ModelSchema, Record<string, never>>[];
};

/**
 * Resolves module stores into two sets:
 *
 * - `storesToInit`: unique runtime instances that must be initialized.
 * - `effectiveStores`: the latest tail of each extension chain, used for
 *   index reconciliation and cloud metadata.
 *
 * Throws if two unrelated chains share the same collection name.
 *
 * @internal
 */
export function resolveStores(stores: Store<ModelSchema, Record<string, never>>[]): ResolvedStores {
  const uniqueStores = [...new Set(stores)];

  // Collect the chain tail for each unique root
  const rootToTail = new Map<AnyStore, AnyStore>();
  for (const store of uniqueStores) {
    const root = store.getChainRoot();
    rootToTail.set(root, root.getChainTail());
  }

  const effectiveStores = [...new Set(rootToTail.values())] as Store<
    ModelSchema,
    Record<string, never>
  >[];

  // Detect collisions: different chains with the same collection name
  const nameToRoot = new Map<string, AnyStore>();
  for (const [root, tail] of rootToTail) {
    const name = tail.getName();
    const existing = nameToRoot.get(name);
    if (existing !== undefined && existing !== root) {
      throw new Error(
        `Store collision: multiple unrelated stores use collection name '${name}'. ` +
          `Use .extend() to create a single extension chain instead of independent stores.`
      );
    }
    nameToRoot.set(name, root);
  }

  return { storesToInit: uniqueStores, effectiveStores };
}

/**
 * Converts effective Store instances to the metadata format
 * used by the cloud backend API.
 *
 * @internal
 */
export function toEffectiveStoreMetadata(
  stores: Store<ModelSchema, Record<string, never>>[]
): EffectiveStoreMetadata[] {
  return stores.map((store) => ({
    name: store.getName(),
    schema: store.getSchema() as Record<string, unknown>,
    indexes: store.getIndexes(),
    searchIndexes: store.getSearchIndexes(),
    indexCreationMode: store.getIndexCreationMode(),
  }));
}
