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

export async function consumeRateLimit(
  { bucket, type, value }: { bucket: string, type: RateLimitType, value: string }
) {
  const rules = allRules.filter(rule => rule.bucket === bucket && rule.type === type);

  for (const rule of rules) {
    await checkRateLimitRule(rule, value);
  }
}

// Two-bucket sliding window approximation to track rate limits.
async function checkRateLimitRule(rule: RateLimitRule, value: string, createError?: () => Error) {
  const createRateLimitError = () => {
    return createError ? createError() : new RateLimitError(`Rate limit exceeded for ${rule.bucket}`);
  };

  const record = await dbRateLimits.findOne({
    bucket: rule.bucket,
    type: rule.type,
    value,
    windowMs: rule.window,
  });

  const now = Date.now();
  const currentWindowStart = Math.floor(now / rule.window) * rule.window;

  const { count, modifier } = record
    ? getCount(record, currentWindowStart, now)
    : {
      count: 0,
      modifier: {
        $setOnInsert: {
          windowStart: new Date(currentWindowStart),
          windowCount: 1,
          prevWindowCount: 0,
          expiresAt: new Date(currentWindowStart + rule.window + rule.window),
        }
      }
    };

  if (count >= rule.limit) {
    throw createRateLimitError();
  }

  /*
    Always use upsert, because there is a small chance the document might be auto-removed
    based on the expiration TTL index in between the check and the update
  */
  await dbRateLimits.upsertOne(
    { bucket: rule.bucket, type: rule.type, value, windowMs: rule.window }, 
    modifier
  );
}

function getCount(record: typeof dbRateLimits['Doc'], currentWindowStart: number, now: number) {
  const prevWindowStart = currentWindowStart - record.windowMs;
  
  if (record.windowStart.getTime() === currentWindowStart) {
    const currentWindowCount = record.windowCount;
    const prevWindowCount = record.prevWindowCount;
    const prevWindowWeight = 1 - (now - currentWindowStart) / record.windowMs;
    return {
      count: Math.round(currentWindowCount + prevWindowCount * prevWindowWeight),
      modifier: {
        $inc: { windowCount: 1 },
        $setOnInsert: {
          windowStart: new Date(currentWindowStart),
          prevWindowCount: 0,
          expiresAt: new Date(currentWindowStart + record.windowMs + record.windowMs),
        }
      }
    };
  }
  
  if (record.windowStart.getTime() === prevWindowStart) {
    const weight = 1 - (now - currentWindowStart) / record.windowMs;
    return {
      count: Math.round(record.windowCount * weight),
      modifier: {
        $set: {
          windowStart: new Date(currentWindowStart),
          windowCount: 1,
          prevWindowCount: record.windowCount,
          expiresAt: new Date(currentWindowStart + record.windowMs + record.windowMs),
        }
      }
    };
  }
  
  return {
    count: 0,
    modifier: {
      $set: {
        windowStart: new Date(currentWindowStart),
        windowCount: 1,
        prevWindowCount: 0,
        expiresAt: new Date(currentWindowStart + record.windowMs + record.windowMs),
      }
    }
  };
}
