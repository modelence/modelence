import { Document, UpdateFilter } from 'mongodb';

import { RateLimitRule, RateLimitType } from './types';
import { dbRateLimits } from './db';
import { RateLimitError } from '../error';

let allRules: Array<RateLimitRule> = [];

export function initRateLimits(rateLimits: RateLimitRule[]) {
  if (allRules.length > 0) {
    throw new Error('Duplicate call to initRateLimits - already initialized');
  }

  allRules = rateLimits;
}

/**
 * This function will check all rate limit rules on the specified bucket and type,
 * throw an error if any of them are exceeded and increase the count of the rate limit record.
 *
 * @category Rate Limits
 *
 * @example
 * ```ts
 * await consumeRateLimit({ bucket: 'api', type: 'ip', value: '127.0.0.1' });
 * ```
 * @param options.bucket - The bucket for the rate limit.
 * @param options.type - The type of the rate limit.
 * @param options.value - The value for the rate limit.
 * @param options.message - Optional custom error message when the rate limit is exceeded.
 */
export async function consumeRateLimit(options: {
  bucket: string;
  type: RateLimitType;
  value: string;
  message?: string;
}) {
  const { bucket, type, value, message } = options;
  const rules = allRules.filter((rule) => rule.bucket === bucket && rule.type === type);
  const createError = message ? () => new RateLimitError(message) : undefined;

  for (const rule of rules) {
    await checkRateLimitRule(rule, value, createError);
  }
}

// Two-bucket sliding window approximation to track rate limits.
async function checkRateLimitRule(rule: RateLimitRule, value: string, createError?: () => Error) {
  const createRateLimitError = () => {
    return createError
      ? createError()
      : new RateLimitError(`Rate limit exceeded for ${rule.bucket}`);
  };

  const filter = {
    bucket: rule.bucket,
    type: rule.type,
    value,
    windowMs: rule.window,
  };

  const now = Date.now();
  const currentWindowStart = Math.floor(now / rule.window) * rule.window;
  const currentWindowStartDate = new Date(currentWindowStart);
  const prevWindowStartDate = new Date(currentWindowStart - rule.window);
  const expiresAtDate = new Date(currentWindowStart + rule.window + rule.window);

  /*
    Rotate the window (if needed) and increment the count in a single atomic
    findOneAndUpdate, using an aggregation-pipeline update so the "which window
    is this document currently in" branching MongoDB runs server-side against
    whatever the document's state is at the moment the update is applied - not
    a value a previous `findOne` read a moment earlier.

    This closes a TOCTOU window: the old code read the count, decided in JS
    whether the limit was exceeded, and only *then* wrote the increment. Two
    concurrent requests could both read a stale sub-limit count before either
    had written its increment, so both would pass. Incrementing first and
    checking the authoritative post-write count instead means a burst can
    over-shoot the limit by at most the number of requests already in flight
    when it was reached, and every one of those still gets a consistent count
    to check against, rather than every one of them replaying the same stale
    read.
  */
  const pipeline: Document[] = [
    {
      $set: {
        prevWindowCount: {
          $switch: {
            branches: [
              {
                case: { $eq: ['$windowStart', currentWindowStartDate] },
                then: '$prevWindowCount',
              },
              {
                case: { $eq: ['$windowStart', prevWindowStartDate] },
                then: '$windowCount',
              },
            ],
            default: 0,
          },
        },
        windowCount: {
          $cond: [
            { $eq: ['$windowStart', currentWindowStartDate] },
            { $add: ['$windowCount', 1] },
            1,
          ],
        },
        windowStart: currentWindowStartDate,
        expiresAt: expiresAtDate,
      },
    },
  ];

  const record = await dbRateLimits.findOneAndUpdate(
    filter,
    pipeline as UpdateFilter<(typeof dbRateLimits)['_type']>,
    {
      upsert: true,
      returnDocument: 'after',
    }
  );

  // upsert: true + returnDocument: 'after' always returns a document.
  const prevWindowWeight = 1 - (now - currentWindowStart) / rule.window;
  const count = Math.round(record!.windowCount + record!.prevWindowCount * prevWindowWeight);

  if (count > rule.limit) {
    throw createRateLimitError();
  }
}
