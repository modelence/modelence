/**
 * Publish function provided to watch handlers.
 * Call this to trigger a re-fetch and send updated data to the client.
 */
export type LiveQueryPublish = () => void;

/**
 * Cleanup function returned by watch handlers.
 * Called when the client unsubscribes.
 */
export type LiveQueryCleanup = () => void;

/**
 * Context passed to watch handlers.
 */
export interface WatchContext {
  publish: LiveQueryPublish;
}

/**
 * Watch function that sets up real-time monitoring.
 * Receives a context with publish callback to trigger re-fetches.
 * Returns a cleanup function.
 */
export type LiveQueryWatch = (context: WatchContext) => LiveQueryCleanup | void;

/**
 * Configuration for creating LiveData.
 */
export interface LiveDataConfig<T = unknown> {
  /**
   * Fetches the current data. Called initially and whenever watch triggers publish.
   */
  fetch: () => Promise<T> | T;
  /**
   * Sets up watching for changes. Receives publish callback and returns cleanup.
   */
  watch: LiveQueryWatch;
}

/**
 * LiveData object returned by live query handlers.
 *
 * @example
 * ```typescript
 * import { LiveData } from 'modelence/server';
 *
 * ...
 *
 *  getTodos({ userId }, context) {
 *    return new LiveData({
 *      fetch: async () => await dbTodos.fetch({ userId }),
 *      watch: ({ publish }) => {
 *        // Subscribe to changes and call publish when data changes
 *        listener.onChange(publish);
 *
 *        return () => {
 *          // Cleanup function to unsubscribe from changes
 *        };
 *      }
 *    });
 *  }
 * ```
 */
export class LiveData<T = unknown> {
  readonly fetch: () => Promise<T> | T;
  readonly watch: LiveQueryWatch;

  constructor(config: LiveDataConfig<T>) {
    this.fetch = config.fetch;
    this.watch = config.watch;
  }
}
