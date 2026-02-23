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
    _id: schema.string(), // unique identifier for the lock, used as the primary key
    instanceId: schema.string(),
    acquiredAt: schema.date(),

    resource: schema.string(), // deprecated, use _id instead
  },
  indexes: [
    {
      // TODO(v1.0.0): remove after dropping legacy `resource` compatibility.
      key: { resource: 1 },
      unique: true,
    },
    {
      // TODO(v1.0.0): remove after dropping legacy `resource` compatibility.
      key: { resource: 1, instanceId: 1 },
    },
    {
      // TODO(v1.0.0): remove after dropping legacy `resource` compatibility.
      key: { resource: 1, acquiredAt: 1 },
    },
  ],
  indexCreationMode: 'blocking',
});
