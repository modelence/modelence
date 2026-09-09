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

  for (let attempt = 0; attempt < 3; attempt++) {
    const now = Date.now();
    const currentWindowStart = Math.floor(now / rule.window) * rule.window;
    const currentWindowDate = new Date(currentWindowStart);
    const expiresAt = new Date(currentWindowStart + rule.window + rule.window);

    const acceptOrReject = async (doc: { windowCount: number; prevWindowCount: number }) => {
      const prevWeight = 1 - (now - currentWindowStart) / rule.window;
      const count = Math.round(doc.windowCount + doc.prevWindowCount * prevWeight);
      if (count > rule.limit) {
        // Compensate the optimistic increment. If a window shift raced us, this
        // matches nothing and the count leaks into prevWindowCount — stricter, not looser.
        await dbRateLimits.updateOne(
          { ...filter, windowStart: currentWindowDate },
          { $inc: { windowCount: -1 } }
        );
        throw createRateLimitError();
      }
    };

    // 1. Try atomic increment if the document is already in the current window.
    const updatedDoc = await dbRateLimits.findOneAndUpdate(
      { ...filter, windowStart: currentWindowDate },
      { $inc: { windowCount: 1 } },
      { returnDocument: 'after' }
    );

    if (updatedDoc) {
      await acceptOrReject(updatedDoc);
      return;
    }

    // 2. Read existing record to handle window transition.
    const existingRecord = await dbRateLimits.findOne(filter);

    if (existingRecord) {
      if (existingRecord.windowStart.getTime() >= currentWindowStart) {
        // A concurrent request already shifted windowStart to currentWindowStart or a newer window!
        // Loop back to Step 1 to perform an atomic $inc on the current window.
        continue;
      }

      const prevWindowStart = currentWindowStart - rule.window;
      const prevWindowCount =
        existingRecord.windowStart.getTime() === prevWindowStart ? existingRecord.windowCount : 0;

      // Atomically shift window only if windowStart has not been modified by a concurrent call
      const shiftedDoc = await dbRateLimits.findOneAndUpdate(
        { ...filter, windowStart: existingRecord.windowStart },
        {
          $set: {
            windowStart: currentWindowDate,
            windowCount: 1,
            prevWindowCount,
            expiresAt,
          },
        },
        { returnDocument: 'after' }
      );

      if (shiftedDoc) {
        await acceptOrReject(shiftedDoc);
        return;
      }

      // If another call shifted the window concurrently, retry loop to hit step 1
      continue;
    }

    // 3. Fallback find-or-create for a brand-new rate-limit key.
    const { doc: upsertedDoc, isNew } = await dbRateLimits.findOneAndUpsert(filter, {
      $setOnInsert: {
        bucket: rule.bucket,
        type: rule.type,
        value,
        windowMs: rule.window,
        windowStart: currentWindowDate,
        windowCount: 1,
        prevWindowCount: 0,
        expiresAt,
      },
    });

    if (upsertedDoc) {
      if (!isNew) {
        // If not newly inserted, a concurrent request created it; retry loop to increment via step 1
        continue;
      }
      await acceptOrReject(upsertedDoc);
      return;
    }
  }

  // Fail-closed if retry attempts are exhausted under extreme concurrency.
  throw createRateLimitError();
}
