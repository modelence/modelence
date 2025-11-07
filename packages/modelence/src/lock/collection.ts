import { schema } from '../data/types';
import { Store } from '../data/store';

/**
 * Database collection for storing distributed locks.
 *
 * Locks are used to ensure that only one instance of the application can acquire
 * a lock for a specific container at a time.
 */
export const locksCollection = new Store('_modelenceLocks', {
  schema: {
    resource: schema.string(),
    containerId: schema.string(),
    acquiredAt: schema.date(),
  },
  indexes: [
    {
      key: { resource: 1 },
      unique: true,
    },
    {
      key: { resource: 1, containerId: 1 },
    },
    {
      key: { resource: 1, acquiredAt: 1 },
    },
  ],
});
