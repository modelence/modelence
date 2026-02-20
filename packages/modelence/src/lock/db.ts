import { schema } from '../data/types';
import { Store } from '../data/store';

/**
 * Database collection for storing distributed locks.
 *
 * Locks are used to ensure that only one instance of the application can perform
 * a specific action at a time, such as running cron jobs or migrations
 */
export const locksCollection = new Store('_modelenceLocks', {
  schema: {
    resource: schema.string(),
    instanceId: schema.string(),
    acquiredAt: schema.date(),
  },
  indexes: [
    {
      key: { resource: 1 },
      unique: true,
    },
    {
      key: { resource: 1, instanceId: 1 },
    },
    {
      key: { resource: 1, acquiredAt: 1 },
    },
  ],
  deduplicateIndexes: async (store) =>
    await store.deduplicateByFields({
      fields: ['resource'],
      sortBy: { resource: 1, acquiredAt: -1, _id: -1 },
    }),
});
