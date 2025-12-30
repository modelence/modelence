import { AsyncLocalStorage } from 'node:async_hooks';
import { Document, Filter } from 'mongodb';
import { Store } from './store';

export interface TrackedLiveQuery {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  store: Store<any, any>;
  filter: Filter<Document>;
  options?: { sort?: Document; limit?: number; skip?: number };
}

export interface LiveQueryExecutionContext {
  trackedQueries: TrackedLiveQuery[];
}

export const liveQueryContext = new AsyncLocalStorage<LiveQueryExecutionContext>();

export async function runInLiveQueryContext<T>(
  handler: () => Promise<T>
): Promise<{ result: T; trackedQueries: TrackedLiveQuery[] }> {
  const context: LiveQueryExecutionContext = {
    trackedQueries: [],
  };

  const result = await liveQueryContext.run(context, handler);

  return {
    result,
    trackedQueries: context.trackedQueries,
  };
}

export function getCurrentLiveQueryContext(): LiveQueryExecutionContext | undefined {
  return liveQueryContext.getStore();
}
