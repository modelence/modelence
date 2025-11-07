import { Module } from '../app/module';
import { locksCollection } from './db';

/**
 * Lock module for distributed locking across multiple instances.
 */
export default new Module('_system.lock', {
  stores: [locksCollection],
});
