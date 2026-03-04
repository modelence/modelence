import { Store } from '../data/store';
import { schema } from '../data/types';

/**
 * Two-bucket sliding window approximation to track rate limits.
 * This is a trade-off between storage and accuracy.
 * We're not keeping exact event logs, so we can't track the exact number of events in a window.
 * Instead, we're adding a weighted average from the previous window to the current window.
 */
export const dbRateLimits = new Store('_modelenceRateLimits', {
  schema: {
    bucket: schema.string(),
    type: schema.enum(['ip', 'user', 'email']),
    value: schema.string(),
    windowMs: schema.number(),

    windowStart: schema.date(),
    windowCount: schema.number(),
    prevWindowCount: schema.number(),

    expiresAt: schema.date(),
  },
  indexes: [
    { key: { bucket: 1, type: 1, value: 1, windowMs: 1 }, unique: true },
    { key: { expiresAt: 1 }, expireAfterSeconds: 0 },
  ],
});
