import { Store } from './store';
import { ModelSchema } from './types';

type NormalizedStore = Store<ModelSchema, Record<string, never>>;

export type ResolvedStores = {
  storesToInit: NormalizedStore[];
  effectiveStores: NormalizedStore[];
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
export function resolveStores(stores: NormalizedStore[]): ResolvedStores {
  const uniqueStores = [...new Set(stores)];

  // Collect the chain tail for each unique root
  const rootToTail = new Map<NormalizedStore, NormalizedStore>();
  for (const store of uniqueStores) {
    const root = store.getChainRoot();
    rootToTail.set(root, root.getChainTail());
  }

  const effectiveStores = [...new Set(rootToTail.values())] as NormalizedStore[];

  // Detect collisions: different chains with the same collection name
  const nameToRoot = new Map<string, NormalizedStore>();
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
