'use client';

import type { ObjectId } from 'mongodb';
import type { ConfigParams, ConfigType, ValueType } from '../config/types';
import { callMethod, type MethodArgs } from './method';
import type { AnyMethodShape } from '../methods/types';

// Pulls the config store value without importing server-side code
import { getConfig as _getClientConfig } from '../config/client';

// ── type helpers ─────────────────────────────────────────────────────────────

/**
 * Recursively maps ObjectId → string to match the sanitized runtime values
 * sent over the wire. Dates are preserved (revived via typeMap on the client).
 */
type Sanitized<T> = T extends ObjectId
  ? string
  : T extends Date
    ? Date
    : T extends (infer U)[]
      ? Sanitized<U>[]
      : T extends object
        ? { [K in keyof T]: Sanitized<T[K]> }
        : T;

type ExtractArgs<M> = M extends (args: infer A, ...rest: any[]) => any // eslint-disable-line @typescript-eslint/no-explicit-any
  ? A
  : M extends { handler: (args: infer A, ...rest: any[]) => any } // eslint-disable-line @typescript-eslint/no-explicit-any
    ? A
    : MethodArgs;

type ExtractResult<M> = M extends (...args: any[]) => Promise<infer R> // eslint-disable-line @typescript-eslint/no-explicit-any
  ? Sanitized<R>
  : M extends { handler: (...args: any[]) => Promise<infer R> } // eslint-disable-line @typescript-eslint/no-explicit-any
    ? Sanitized<R>
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
 *
 * Use `import type` to reference the module so no server code is bundled on the client.
 * Arg and return types for queries and mutations are inferred automatically from the
 * server-side handler signatures.
 *
 * @param moduleName - The module's name as passed to `new Module(name, ...)`.
 *
 * @example
 * ```ts
 * // src/client/payments.ts
 * import type paymentsModule from '../server/payments';
 * import { createClientModule } from 'modelence/client';
 *
 * export const payments = createClientModule<typeof paymentsModule>('payments');
 * ```
 *
 * ```ts
 * // src/components/Checkout.tsx
 * import { useQuery, useMutation } from '@tanstack/react-query';
 * import { payments } from '../client/payments';
 *
 * // Typed config — public keys only, private and secret keys excluded:
 * const currency = payments.getConfig('currency'); // string | undefined
 *
 * // Typed query — pass directly to useQuery:
 * const { data: products } = useQuery(payments.query('getProducts', { page: 1 }));
 *
 * // Typed mutation — pass directly to useMutation:
 * const { mutate: charge } = useMutation(payments.mutation('charge'));
 * charge({ amount: 100 }); // args typed from handler signature
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
      ...rest: {} extends ExtractArgs<TModule['queries'][K]>
        ? [args?: ExtractArgs<TModule['queries'][K]>]
        : [args: ExtractArgs<TModule['queries'][K]>]
    ) {
      const args = (rest[0] ?? {}) as ExtractArgs<TModule['queries'][K]>;
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

    /**
     * Returns options for `useInfiniteQuery`. The `getArgs` callback receives the
     * current `pageParam` and returns the args to pass to the query handler.
     * Spread the result into `useInfiniteQuery` alongside `getNextPageParam`.
     *
     * Annotate the `pageParam` type in the callback so TypeScript can infer the
     * page param type — no manual generic needed on `useInfiniteQuery`.
     *
     * @example
     * ```ts
     * useInfiniteQuery({
     *   ...appFilesClient.infiniteQuery('listFiles', (cursor: string | undefined) => ({
     *     environmentId,
     *     ...(cursor ? { cursor } : {}),
     *   })),
     *   getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
     * });
     * // data is typed as InfiniteData<{ files: AppFile[]; nextCursor: string | null }>
     * ```
     */
    infiniteQuery<K extends keyof TModule['queries'] & string, TPageParam = unknown>(
      name: K,
      getArgs: (pageParam: TPageParam | undefined) => ExtractArgs<TModule['queries'][K]>
    ) {
      return {
        queryKey: [moduleName, name, 'infinite', getArgs(undefined)] as const,
        // Included so TanStack infers TPageParam from the callback type, not from a bare `undefined`.
        initialPageParam: undefined as TPageParam | undefined,
        queryFn: ({
          pageParam,
        }: {
          pageParam: TPageParam | undefined;
        }): Promise<ExtractResult<TModule['queries'][K]>> =>
          callMethod<ExtractResult<TModule['queries'][K]>>(
            `${moduleName}.${name}`,
            getArgs(pageParam) as MethodArgs
          ),
      };
    },
  };
}
