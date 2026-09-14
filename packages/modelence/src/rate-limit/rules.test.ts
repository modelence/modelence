import { afterEach, describe, expect, test, vi } from 'vitest';
import type { Mock } from 'vitest';

type SetupResult = {
  initRateLimits: typeof import('./rules').initRateLimits;
  consumeRateLimit: typeof import('./rules').consumeRateLimit;
  mocks: {
    findOneAndUpdate: Mock;
  };
};

async function loadModule(): Promise<SetupResult> {
  vi.resetModules();

  const mockFindOneAndUpdate = vi.fn();

  vi.doMock('./db', () => ({
    dbRateLimits: {
      findOneAndUpdate: mockFindOneAndUpdate,
    },
  }));

  const mod = await import('./rules');

  return {
    initRateLimits: mod.initRateLimits,
    consumeRateLimit: mod.consumeRateLimit,
    mocks: {
      findOneAndUpdate: mockFindOneAndUpdate,
    },
  };
}

describe('rate-limit/rules', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test('initRateLimits throws on duplicate initialization', async () => {
    const { initRateLimits } = await loadModule();

    initRateLimits([{ bucket: 'api', type: 'ip', window: 1000, limit: 10 }]);

    expect(() => initRateLimits([{ bucket: 'api', type: 'ip', window: 1000, limit: 10 }])).toThrow(
      'Duplicate call to initRateLimits - already initialized'
    );
  });

  test('consumeRateLimit issues a single atomic findOneAndUpdate, not a separate read+write', async () => {
    vi.useFakeTimers().setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
    const { initRateLimits, consumeRateLimit, mocks } = await loadModule();

    initRateLimits([{ bucket: 'api', type: 'ip', window: 60_000, limit: 5 }]);
    mocks.findOneAndUpdate.mockResolvedValue({
      windowStart: new Date('2024-01-01T00:00:00.000Z'),
      windowCount: 1,
      prevWindowCount: 0,
      expiresAt: new Date('2024-01-01T00:02:00.000Z'),
    });

    await consumeRateLimit({ bucket: 'api', type: 'ip', value: '127.0.0.1' });

    expect(mocks.findOneAndUpdate).toHaveBeenCalledTimes(1);
    const [filter, , options] = mocks.findOneAndUpdate.mock.calls[0];
    expect(filter).toEqual({ bucket: 'api', type: 'ip', value: '127.0.0.1', windowMs: 60_000 });
    expect(options).toEqual({ upsert: true, returnDocument: 'after' });
  });

  test('consumeRateLimit allows the request that brings the count exactly to the limit', async () => {
    vi.useFakeTimers().setSystemTime(new Date('2024-01-01T00:01:00.000Z'));
    const { initRateLimits, consumeRateLimit, mocks } = await loadModule();

    initRateLimits([{ bucket: 'login', type: 'ip', window: 60_000, limit: 3 }]);

    // Post-increment state already reflects this request's own +1 from the atomic update.
    mocks.findOneAndUpdate.mockResolvedValue({
      windowStart: new Date('2024-01-01T00:01:00.000Z'),
      windowCount: 3,
      prevWindowCount: 0,
      expiresAt: new Date('2024-01-01T00:03:00.000Z'),
    });

    await expect(
      consumeRateLimit({ bucket: 'login', type: 'ip', value: '10.0.0.1' })
    ).resolves.toBeUndefined();
  });

  test('consumeRateLimit throws once the post-increment count exceeds the limit', async () => {
    vi.useFakeTimers().setSystemTime(new Date('2024-01-01T00:01:00.000Z'));
    const { initRateLimits, consumeRateLimit, mocks } = await loadModule();

    initRateLimits([{ bucket: 'login', type: 'ip', window: 60_000, limit: 3 }]);

    mocks.findOneAndUpdate.mockResolvedValue({
      windowStart: new Date('2024-01-01T00:01:00.000Z'),
      windowCount: 4,
      prevWindowCount: 0,
      expiresAt: new Date('2024-01-01T00:03:00.000Z'),
    });

    await expect(
      consumeRateLimit({ bucket: 'login', type: 'ip', value: '10.0.0.1' })
    ).rejects.toThrow('Rate limit exceeded for login');
  });

  test('consumeRateLimit uses custom error message when provided', async () => {
    vi.useFakeTimers().setSystemTime(new Date('2024-01-01T00:01:00.000Z'));
    const { initRateLimits, consumeRateLimit, mocks } = await loadModule();

    initRateLimits([{ bucket: 'login', type: 'ip', window: 60_000, limit: 1 }]);

    mocks.findOneAndUpdate.mockResolvedValue({
      windowStart: new Date('2024-01-01T00:01:00.000Z'),
      windowCount: 2,
      prevWindowCount: 0,
      expiresAt: new Date('2024-01-01T00:03:00.000Z'),
    });

    await expect(
      consumeRateLimit({
        bucket: 'login',
        type: 'ip',
        value: '127.0.0.1',
        message: 'Please slow down',
      })
    ).rejects.toThrow('Please slow down');
  });

  test('consumeRateLimit weighs prevWindowCount by how far into the current window we are', async () => {
    // 15s into a 60s window => prevWindowWeight = 1 - 15/60 = 0.75
    vi.useFakeTimers().setSystemTime(new Date('2024-01-01T00:01:15.000Z'));
    const { initRateLimits, consumeRateLimit, mocks } = await loadModule();

    // windowCount=1 (this request) + round(4 * 0.75) = 1 + 3 = 4 <= limit(4) => allowed
    initRateLimits([{ bucket: 'api', type: 'ip', window: 60_000, limit: 4 }]);
    mocks.findOneAndUpdate.mockResolvedValue({
      windowStart: new Date('2024-01-01T00:01:00.000Z'),
      windowCount: 1,
      prevWindowCount: 4,
      expiresAt: new Date('2024-01-01T00:03:00.000Z'),
    });

    await expect(
      consumeRateLimit({ bucket: 'api', type: 'ip', value: '127.0.0.1' })
    ).resolves.toBeUndefined();
  });
});
