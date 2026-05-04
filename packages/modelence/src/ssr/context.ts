import { AsyncLocalStorage } from 'node:async_hooks';
import type { QueryClient } from '@tanstack/react-query';
import type { Context } from '../methods/types';

/**
 * Per-request state available to any code running inside an SSR render.
 *
 * `callContext` is the same shape `runMethod` expects (auth, roles, clientInfo,
 * connectionInfo). `queryClient` is the per-request TanStack Query cache that
 * `useQuery` calls populate during SSR — the client later hydrates from the
 * dehydrated form of this same cache.
 */
export type SsrRequestContext = {
  callContext: Context;
  queryClient: QueryClient;
};

const storage = new AsyncLocalStorage<SsrRequestContext>();

export function runWithSsrContext<T>(ctx: SsrRequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export function getSsrContext(): SsrRequestContext | undefined {
  return storage.getStore();
}

export function isSsr(): boolean {
  return typeof window === 'undefined';
}
