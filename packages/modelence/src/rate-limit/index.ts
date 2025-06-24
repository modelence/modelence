import { Module } from '../app/module';
import { dbRateLimits } from './db';

export default new Module('_system.rateLimit', {
  stores: [dbRateLimits],
});
