/**
 * Publish function provided to live query handlers.
 * Call this to send data to the subscribed client.
 */
export type LiveQueryPublish<T = unknown> = (data: T) => void;

/**
 * Cleanup function returned by live query handlers.
 * Called when the client unsubscribes.
 */
export type LiveQueryCleanup = () => void;

/**
 * Context provided to live query handlers.
 */
export interface LiveQueryContext {
  publish: LiveQueryPublish;
}

