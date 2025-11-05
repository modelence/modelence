import { Module } from '../app/module';
import { locksCollection } from './collection';

/**
 * Lock module for distributed locking across multiple instances.
 *
 * This module provides the infrastructure for acquiring and managing
 * distributed locks using MongoDB. Locks prevent multiple instances
 * from executing the same critical section simultaneously.
 *
 * @example
 * ```typescript
 * // Acquire a lock
 * const lock = await locksCollection.insertOne({
 *   containerId: 'instance-123',
 *   acquiredAt: new Date(),
 *   heartbeatAt: new Date(),
 * });
 * ```
 */
export default new Module('_system.lock', {
  stores: [locksCollection],
});
