import { schema } from '../data/types';
import { Store } from '../data/store';

/**
 * Database collection for storing distributed locks.
 *
 * Locks are used to ensure that only one instance of a process can acquire
 * a lock for a specific container at a time.
 *
 * @example
 * ```typescript
 * // Acquire a lock for a container
 * const lock = await locksCollection.insertOne({
 *   containerId: 'my-job',
 *   acquiredAt: new Date(),
 *   heartbeatAt: new Date(),
 * });
 * ```
 */
export const locksCollection = new Store('_modelenceLocks', {
  schema: {
    type: schema.string(),
    containerId: schema.string(),
    acquiredAt: schema.date(),
    heartbeatAt: schema.date(),
  },
  indexes: [
    {
      key: { type: 1, containerId: 1 },
      unique: true,
    },
  ],
});
