'use client';

import type { ConfigParams, ConfigType, ValueType } from '../config/types';
import { callMethod, type MethodArgs } from './method';

// Pulls the config store value without importing server-side code
import { getConfig as _getClientConfig } from '../config/client';

// ── type helpers ─────────────────────────────────────────────────────────────

type AnyMethodShape = ((...args: any[]) => any) | { handler: (...args: any[]) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any

type ExtractArgs<M> = M extends (args: infer A, ...rest: any[]) => any // eslint-disable-line @typescript-eslint/no-explicit-any
  ? A
  : M extends { handler: (args: infer A, ...rest: any[]) => any } // eslint-disable-line @typescript-eslint/no-explicit-any
    ? A
    : MethodArgs;

type ExtractResult<M> = M extends (...args: any[]) => Promise<infer R> // eslint-disable-line @typescript-eslint/no-explicit-any
  ? R
  : M extends { handler: (...args: any[]) => Promise<infer R> } // eslint-disable-line @typescript-eslint/no-explicit-any
    ? R
    : unknown;

type PublicKeyOf<TSchema extends Record<string, ConfigParams>> = {
  [K in keyof TSchema as TSchema[K] extends ConfigParams<ConfigType, true>
    ? string & K
    : never]: ValueType<TSchema[K]['type']>;
};

type AnyModule = {
  name: string;
  configSchema: Record<string, ConfigParams>;
  queries: Record<string, AnyMethodShape>;
  mutations: Record<string, AnyMethodShape>;
};

// ── createClientModule ────────────────────────────────────────────────────────

/**
 * Creates a typed client accessor for a module's public configs, queries, and mutations.
 * Use `import type` to reference the module — no server code is bundled.
 *
 * @example
 * ```ts
 * import type adminModule from '../server/admin/module';
 * import { createClientModule } from 'modelence/client';
 *
 * export const admin = createClientModule<typeof adminModule>('admin');
 *
 * // Typed config (public only):
 * admin.getConfig('currency');  // → string | undefined
 *
 * // Typed query options (pass directly to useQuery):
 * admin.query('getUsers', { page: 1 });
 *
 * // Typed mutation options (pass directly to useMutation):
 * admin.mutation('previewBulkCredits');
 * ```
 */
export function createClientModule<TModule extends AnyModule>(moduleName: string) {
  return {
    getConfig<K extends keyof PublicKeyOf<TModule['configSchema']> & string>(
      key: K
    ): PublicKeyOf<TModule['configSchema']>[K] | undefined {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return _getClientConfig(`${moduleName}.${key}`) as any;
    },

    query<K extends keyof TModule['queries'] & string>(
      name: K,
      args: ExtractArgs<TModule['queries'][K]> = {} as ExtractArgs<TModule['queries'][K]>
    ) {
      return {
        queryKey: [moduleName, name, args] as const,
        queryFn: (): Promise<ExtractResult<TModule['queries'][K]>> =>
          callMethod<ExtractResult<TModule['queries'][K]>>(
            `${moduleName}.${name}`,
            args as MethodArgs
          ),
      };
    },

    mutation<K extends keyof TModule['mutations'] & string>(name: K) {
      return {
        mutationFn: (
          args: ExtractArgs<TModule['mutations'][K]>
        ): Promise<ExtractResult<TModule['mutations'][K]>> =>
          callMethod<ExtractResult<TModule['mutations'][K]>>(
            `${moduleName}.${name}`,
            args as MethodArgs
          ),
      };
    },
  };
}
