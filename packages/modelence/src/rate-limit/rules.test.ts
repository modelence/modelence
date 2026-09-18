import { afterEach, describe, expect, test, vi } from 'vitest';
import type { Mock } from 'vitest';

type SetupResult = {
  initRateLimits: typeof import('./rules').initRateLimits;
  consumeRateLimit: typeof import('./rules').consumeRateLimit;
  mocks: {
    findOne: Mock;
    upsertOne: Mock;
  };
};

async function loadModule(): Promise<SetupResult> {
  vi.resetModules();

  const mockFindOne = vi.fn();
  const mockUpsertOne = vi.fn();

  vi.doMock('./db', () => ({
    dbRateLimits: {
      findOne: mockFindOne,
      upsertOne: mockUpsertOne,
    },
  }));

  const mod = await import('./rules');

  return {
    initRateLimits: mod.initRateLimits,
    consumeRateLimit: mod.consumeRateLimit,
    mocks: {
      findOne: mockFindOne,
      upsertOne: mockUpsertOne,
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

  test('consumeRateLimit inserts new record when no existing entry', async () => {
    vi.useFakeTimers().setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
    const { initRateLimits, consumeRateLimit, mocks } = await loadModule();

    initRateLimits([{ bucket: 'api', type: 'ip', window: 60_000, limit: 5 }]);
    mocks.findOne.mockResolvedValue(null as never);

    await consumeRateLimit({ bucket: 'api', type: 'ip', value: '127.0.0.1' });

    expect(mocks.findOne).toHaveBeenCalledWith({
      bucket: 'api',
      type: 'ip',
      value: '127.0.0.1',
      windowMs: 60_000,
    });
    expect(mocks.upsertOne).toHaveBeenCalledWith(
      { bucket: 'api', type: 'ip', value: '127.0.0.1', windowMs: 60_000 },
      {
        $setOnInsert: {
          windowStart: new Date('2024-01-01T00:00:00.000Z'),
          windowCount: 1,
          prevWindowCount: 0,
          expiresAt: new Date('2024-01-01T00:02:00.000Z'),
        },
      }
    );
  });

  test('consumeRateLimit throws when limit exceeded in current window', async () => {
    vi.useFakeTimers().setSystemTime(new Date('2024-01-01T00:01:00.000Z'));
    const { initRateLimits, consumeRateLimit, mocks } = await loadModule();

    initRateLimits([{ bucket: 'api', type: 'ip', window: 60_000, limit: 1 }]);

    mocks.findOne.mockResolvedValue({
      bucket: 'api',
      type: 'ip',
      value: '127.0.0.1',
      windowMs: 60_000,
      windowStart: new Date('2024-01-01T00:01:00.000Z'),
      windowCount: 1,
      prevWindowCount: 0,
      expiresAt: new Date('2024-01-01T00:03:00.000Z'),
    } as never);

    await expect(
      consumeRateLimit({ bucket: 'api', type: 'ip', value: '127.0.0.1' })
    ).rejects.toThrow('Rate limit exceeded for api');

    expect(mocks.upsertOne).not.toHaveBeenCalled();
  });

  test('consumeRateLimit uses custom error message when provided', async () => {
    vi.useFakeTimers().setSystemTime(new Date('2024-01-01T00:01:00.000Z'));
    const { initRateLimits, consumeRateLimit, mocks } = await loadModule();

    initRateLimits([{ bucket: 'api', type: 'ip', window: 60_000, limit: 1 }]);

    mocks.findOne.mockResolvedValue({
      bucket: 'api',
      type: 'ip',
      value: '127.0.0.1',
      windowMs: 60_000,
      windowStart: new Date('2024-01-01T00:01:00.000Z'),
      windowCount: 1,
      prevWindowCount: 0,
      expiresAt: new Date('2024-01-01T00:03:00.000Z'),
    } as never);

    await expect(
      consumeRateLimit({
        bucket: 'api',
        type: 'ip',
        value: '127.0.0.1',
        message: 'Please slow down',
      })
    ).rejects.toThrow('Please slow down');

    expect(mocks.upsertOne).not.toHaveBeenCalled();
  });

  test('consumeRateLimit throws when rate limit count meets or exceeds limit threshold', async () => {
    vi.useFakeTimers().setSystemTime(new Date('2024-01-01T00:01:00.000Z'));
    const { initRateLimits, consumeRateLimit, mocks } = await loadModule();

    initRateLimits([{ bucket: 'login', type: 'ip', window: 60_000, limit: 3 }]);

    mocks.findOne.mockResolvedValue({
      bucket: 'login',
      type: 'ip',
      value: '10.0.0.1',
      windowMs: 60_000,
      windowStart: new Date('2024-01-01T00:01:00.000Z'),
      windowCount: 3,
      prevWindowCount: 0,
      expiresAt: new Date('2024-01-01T00:03:00.000Z'),
    } as never);

    await expect(
      consumeRateLimit({ bucket: 'login', type: 'ip', value: '10.0.0.1' })
    ).rejects.toThrow('Rate limit exceeded for login');

    expect(mocks.upsertOne).not.toHaveBeenCalled();
  });

  test('sustained over-limit burst results in zero write operations for rejected requests', async () => {
    vi.useFakeTimers().setSystemTime(new Date('2024-01-01T00:01:00.000Z'));
    const { initRateLimits, consumeRateLimit, mocks } = await loadModule();

    initRateLimits([{ bucket: 'signup', type: 'ip', window: 60_000, limit: 2 }]);

    mocks.findOne.mockResolvedValue({
      bucket: 'signup',
      type: 'ip',
      value: '10.0.0.2',
      windowMs: 60_000,
      windowStart: new Date('2024-01-01T00:01:00.000Z'),
      windowCount: 2,
      prevWindowCount: 0,
      expiresAt: new Date('2024-01-01T00:03:00.000Z'),
    } as never);

    // Simulate burst of 10 rejected requests
    for (let i = 0; i < 10; i++) {
      await expect(
        consumeRateLimit({ bucket: 'signup', type: 'ip', value: '10.0.0.2' })
      ).rejects.toThrow('Rate limit exceeded for signup');
    }

    // Verify exactly 0 upsertOne calls were issued across all rejected burst requests
    expect(mocks.upsertOne).toHaveBeenCalledTimes(0);
    expect(mocks.findOne).toHaveBeenCalledTimes(10);
  });

  test('sliding-window boundary case executes optimistic increment then compensating decrement when count exceeds limit', async () => {
    // At t = 10s into a 60s window (weight for prev window = 50/60 = 0.833)
    vi.useFakeTimers().setSystemTime(new Date('2024-01-01T00:00:10.000Z'));
    const { initRateLimits, consumeRateLimit, mocks } = await loadModule();

    initRateLimits([{ bucket: 'api', type: 'ip', window: 60_000, limit: 5 }]);

    // windowCount is 1 (< limit of 5), but prevWindowCount is 5.
    // Weighted count = 1 + round(5 * (50/60)) = 1 + 4 = 5.
    mocks.findOne.mockResolvedValue({
      bucket: 'api',
      type: 'ip',
      value: '127.0.0.1',
      windowMs: 60_000,
      windowStart: new Date('2024-01-01T00:00:00.000Z'),
      windowCount: 1,
      prevWindowCount: 5,
      expiresAt: new Date('2024-01-01T00:02:00.000Z'),
    } as never);

    await expect(
      consumeRateLimit({ bucket: 'api', type: 'ip', value: '127.0.0.1' })
    ).rejects.toThrow('Rate limit exceeded for api');

    // Fast-path did not trigger because windowCount (1) < limit (5).
    // Initial increment was issued, followed by compensating decrement.
    expect(mocks.upsertOne).toHaveBeenNthCalledWith(
      1,
      { bucket: 'api', type: 'ip', value: '127.0.0.1', windowMs: 60_000 },
      {
        $inc: { windowCount: 1 },
        $setOnInsert: {
          windowStart: new Date('2024-01-01T00:00:00.000Z'),
          prevWindowCount: 0,
          expiresAt: new Date('2024-01-01T00:02:00.000Z'),
        },
      }
    );
    expect(mocks.upsertOne).toHaveBeenNthCalledWith(
      2,
      { bucket: 'api', type: 'ip', value: '127.0.0.1', windowMs: 60_000 },
      { $inc: { windowCount: -1 } }
    );
  });
});
