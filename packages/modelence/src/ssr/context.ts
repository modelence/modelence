import { AsyncLocalStorage } from 'node:async_hooks';
import type { QueryClient } from '@tanstack/react-query';
import type { Context } from '../methods/types';

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
