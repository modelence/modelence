import { RateLimitRule, RateLimitType } from './types';
import { dbRateLimits } from './db';

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
async function checkRateLimitRule(rule: RateLimitRule, value: string, errorHandler?: () => Error) {
  const throwRateLimitError = () => {
    if (errorHandler) {
      errorHandler();
    } else {
      throw new Error(`Rate limit exceeded for ${rule.bucket}`);
    }
  };

  const record = await dbRateLimits.findOne({
    bucket: rule.bucket,
    type: rule.type,
    value,
    windowMs: rule.window,
  });

  const now = Date.now();
  const currentWindowStart = Math.floor(now / rule.window) * rule.window;

  if (record) {
    const { count, modifier } = getCount(record, currentWindowStart, now);
    if (count >= rule.limit) {
      throwRateLimitError();
    }

    await dbRateLimits.updateOne(record._id.toString(), modifier);
  } else {
    if (rule.limit < 1) {
      throwRateLimitError();
      return;
    }

    await dbRateLimits.insertOne({
      bucket: rule.bucket,
      type: rule.type,
      value,
      windowMs: rule.window,

      windowStart: new Date(currentWindowStart),
      windowCount: 1,
      prevWindowCount: 0,
      expiresAt: new Date(currentWindowStart + rule.window + rule.window),
    });
  }
}

function getCount(record: typeof dbRateLimits['Doc'], currentWindowStart: number, now: number) {
  const prevWindowStart = currentWindowStart - record.windowMs;
  
  if (record.windowStart.getTime() === currentWindowStart) {
    const currentWindowCount = record.windowCount;
    const prevWindowCount = record.prevWindowCount;
    const prevWindowWeight = (1 - (now - currentWindowStart)) / record.windowMs;
    return {
      count: currentWindowCount + prevWindowCount * prevWindowWeight,
      modifier: {
        $inc: { windowCount: 1 },
      }
    };
  }
  
  if (record.windowStart.getTime() === prevWindowStart) {
    const weight = (1 - (now - currentWindowStart)) / record.windowMs;
    return {
      count: record.windowCount * weight,
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
