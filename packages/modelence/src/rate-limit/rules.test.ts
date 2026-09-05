import { afterEach, describe, expect, test, vi } from 'vitest';
import type { Mock } from 'vitest';

type SetupResult = {
  initRateLimits: typeof import('./rules').initRateLimits;
  consumeRateLimit: typeof import('./rules').consumeRateLimit;
  mocks: {
    findOne: Mock;
    findOneAndUpdate: Mock;
    findOneAndUpsert: Mock;
    updateOne: Mock;
  };
};

async function loadModule(): Promise<SetupResult> {
  vi.resetModules();

  const mockFindOne = vi.fn();
  const mockFindOneAndUpdate = vi.fn();
  const mockFindOneAndUpsert = vi.fn();
  const mockUpdateOne = vi.fn();

  vi.doMock('./db', () => ({
    dbRateLimits: {
      findOne: mockFindOne,
      findOneAndUpdate: mockFindOneAndUpdate,
      findOneAndUpsert: mockFindOneAndUpsert,
      updateOne: mockUpdateOne,
    },
  }));

  const mod = await import('./rules');

  return {
    initRateLimits: mod.initRateLimits,
    consumeRateLimit: mod.consumeRateLimit,
    mocks: {
      findOne: mockFindOne,
      findOneAndUpdate: mockFindOneAndUpdate,
      findOneAndUpsert: mockFindOneAndUpsert,
      updateOne: mockUpdateOne,
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

  test('consumeRateLimit inserts new record atomically when entry does not exist', async () => {
    vi.useFakeTimers().setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
    const { initRateLimits, consumeRateLimit, mocks } = await loadModule();

    initRateLimits([{ bucket: 'api', type: 'ip', window: 60_000, limit: 5 }]);
    mocks.findOneAndUpdate.mockResolvedValueOnce(null);
    mocks.findOne.mockResolvedValueOnce(null);
    mocks.findOneAndUpsert.mockResolvedValueOnce({
      doc: {
        bucket: 'api',
        type: 'ip',
        value: '127.0.0.1',
        windowMs: 60_000,
        windowStart: new Date('2024-01-01T00:00:00.000Z'),
        windowCount: 1,
        prevWindowCount: 0,
        expiresAt: new Date('2024-01-01T00:02:00.000Z'),
      },
      isNew: true,
    });

    await consumeRateLimit({ bucket: 'api', type: 'ip', value: '127.0.0.1' });

    expect(mocks.findOneAndUpdate).toHaveBeenCalledWith(
      {
        bucket: 'api',
        type: 'ip',
        value: '127.0.0.1',
        windowMs: 60_000,
        windowStart: new Date('2024-01-01T00:00:00.000Z'),
      },
      { $inc: { windowCount: 1 } },
      { returnDocument: 'after' }
    );
    expect(mocks.findOneAndUpsert).toHaveBeenCalledWith(
      { bucket: 'api', type: 'ip', value: '127.0.0.1', windowMs: 60_000 },
      {
        $setOnInsert: {
          bucket: 'api',
          type: 'ip',
          value: '127.0.0.1',
          windowMs: 60_000,
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

    mocks.findOneAndUpdate.mockResolvedValueOnce({
      bucket: 'api',
      type: 'ip',
      value: '127.0.0.1',
      windowMs: 60_000,
      windowStart: new Date('2024-01-01T00:01:00.000Z'),
      windowCount: 2,
      prevWindowCount: 0,
      expiresAt: new Date('2024-01-01T00:03:00.000Z'),
    });

    await expect(
      consumeRateLimit({ bucket: 'api', type: 'ip', value: '127.0.0.1' })
    ).rejects.toThrow('Rate limit exceeded for api');

    expect(mocks.updateOne).toHaveBeenCalledWith(
      {
        bucket: 'api',
        type: 'ip',
        value: '127.0.0.1',
        windowMs: 60_000,
        windowStart: new Date('2024-01-01T00:01:00.000Z'),
      },
      { $inc: { windowCount: -1 } }
    );
  });

  test('consumeRateLimit uses custom error message when provided', async () => {
    vi.useFakeTimers().setSystemTime(new Date('2024-01-01T00:01:00.000Z'));
    const { initRateLimits, consumeRateLimit, mocks } = await loadModule();

    initRateLimits([{ bucket: 'api', type: 'ip', window: 60_000, limit: 1 }]);

    mocks.findOneAndUpdate.mockResolvedValueOnce({
      bucket: 'api',
      type: 'ip',
      value: '127.0.0.1',
      windowMs: 60_000,
      windowStart: new Date('2024-01-01T00:01:00.000Z'),
      windowCount: 2,
      prevWindowCount: 0,
      expiresAt: new Date('2024-01-01T00:03:00.000Z'),
    });

    await expect(
      consumeRateLimit({
        bucket: 'api',
        type: 'ip',
        value: '127.0.0.1',
        message: 'Please slow down',
      })
    ).rejects.toThrow('Please slow down');
  });

  test('consumeRateLimit shifts window atomically when window changes', async () => {
    vi.useFakeTimers().setSystemTime(new Date('2024-01-01T00:01:00.000Z'));
    const { initRateLimits, consumeRateLimit, mocks } = await loadModule();

    initRateLimits([{ bucket: 'api', type: 'ip', window: 60_000, limit: 5 }]);

    mocks.findOneAndUpdate.mockResolvedValueOnce(null); // Step 1: no doc for current window
    mocks.findOne.mockResolvedValueOnce({
      bucket: 'api',
      type: 'ip',
      value: '127.0.0.1',
      windowMs: 60_000,
      windowStart: new Date('2024-01-01T00:00:00.000Z'),
      windowCount: 3,
      prevWindowCount: 0,
      expiresAt: new Date('2024-01-01T00:02:00.000Z'),
    });
    mocks.findOneAndUpdate.mockResolvedValueOnce({
      bucket: 'api',
      type: 'ip',
      value: '127.0.0.1',
      windowMs: 60_000,
      windowStart: new Date('2024-01-01T00:01:00.000Z'),
      windowCount: 1,
      prevWindowCount: 3,
      expiresAt: new Date('2024-01-01T00:03:00.000Z'),
    });

    await consumeRateLimit({ bucket: 'api', type: 'ip', value: '127.0.0.1' });

    expect(mocks.findOneAndUpdate).toHaveBeenNthCalledWith(
      2,
      {
        bucket: 'api',
        type: 'ip',
        value: '127.0.0.1',
        windowMs: 60_000,
        windowStart: new Date('2024-01-01T00:00:00.000Z'),
      },
      {
        $set: {
          windowStart: new Date('2024-01-01T00:01:00.000Z'),
          windowCount: 1,
          prevWindowCount: 3,
          expiresAt: new Date('2024-01-01T00:03:00.000Z'),
        },
      },
      { returnDocument: 'after' }
    );
  });

  test('retries atomic increment when concurrent request already shifted windowStart', async () => {
    vi.useFakeTimers().setSystemTime(new Date('2024-01-01T00:01:00.000Z'));
    const { initRateLimits, consumeRateLimit, mocks } = await loadModule();

    initRateLimits([{ bucket: 'api', type: 'ip', window: 60_000, limit: 5 }]);

    mocks.findOneAndUpdate.mockResolvedValueOnce(null);
    mocks.findOne.mockResolvedValueOnce({
      bucket: 'api',
      type: 'ip',
      value: '127.0.0.1',
      windowMs: 60_000,
      windowStart: new Date('2024-01-01T00:01:00.000Z'),
      windowCount: 2,
      prevWindowCount: 1,
      expiresAt: new Date('2024-01-01T00:03:00.000Z'),
    });
    mocks.findOneAndUpdate.mockResolvedValueOnce({
      bucket: 'api',
      type: 'ip',
      value: '127.0.0.1',
      windowMs: 60_000,
      windowStart: new Date('2024-01-01T00:01:00.000Z'),
      windowCount: 3,
      prevWindowCount: 1,
      expiresAt: new Date('2024-01-01T00:03:00.000Z'),
    });

    await consumeRateLimit({ bucket: 'api', type: 'ip', value: '127.0.0.1' });

    expect(mocks.findOneAndUpdate).toHaveBeenNthCalledWith(
      2,
      {
        bucket: 'api',
        type: 'ip',
        value: '127.0.0.1',
        windowMs: 60_000,
        windowStart: new Date('2024-01-01T00:01:00.000Z'),
      },
      { $inc: { windowCount: 1 } },
      { returnDocument: 'after' }
    );
  });

  test('retries loop and does not overwrite window when existingRecord has a newer windowStart', async () => {
    vi.useFakeTimers().setSystemTime(new Date('2024-01-01T00:01:00.000Z'));
    const { initRateLimits, consumeRateLimit, mocks } = await loadModule();

    initRateLimits([{ bucket: 'api', type: 'ip', window: 60_000, limit: 5 }]);

    mocks.findOneAndUpdate.mockResolvedValueOnce(null); // Attempt 1 Step 1: no doc for 00:01:00
    // Attempt 1 Step 2: findOne returns a record from 00:02:00 (a NEWER window start)
    mocks.findOne.mockImplementationOnce(async () => {
      vi.setSystemTime(new Date('2024-01-01T00:02:10.000Z'));
      return {
        bucket: 'api',
        type: 'ip',
        value: '127.0.0.1',
        windowMs: 60_000,
        windowStart: new Date('2024-01-01T00:02:00.000Z'),
        windowCount: 2,
        prevWindowCount: 1,
        expiresAt: new Date('2024-01-01T00:04:00.000Z'),
      };
    });

    mocks.findOneAndUpdate.mockResolvedValueOnce({
      bucket: 'api',
      type: 'ip',
      value: '127.0.0.1',
      windowMs: 60_000,
      windowStart: new Date('2024-01-01T00:02:00.000Z'),
      windowCount: 3,
      prevWindowCount: 2,
      expiresAt: new Date('2024-01-01T00:04:00.000Z'),
    });

    await consumeRateLimit({ bucket: 'api', type: 'ip', value: '127.0.0.1' });

    // Attempt 2 should attempt Step 1 with the updated windowStart 00:02:00
    expect(mocks.findOneAndUpdate).toHaveBeenNthCalledWith(
      2,
      {
        bucket: 'api',
        type: 'ip',
        value: '127.0.0.1',
        windowMs: 60_000,
        windowStart: new Date('2024-01-01T00:02:00.000Z'),
      },
      { $inc: { windowCount: 1 } },
      { returnDocument: 'after' }
    );
  });

  test('consumeRateLimit fails closed when retry attempts are exhausted', async () => {
    vi.useFakeTimers().setSystemTime(new Date('2024-01-01T00:01:00.000Z'));
    const { initRateLimits, consumeRateLimit, mocks } = await loadModule();

    initRateLimits([{ bucket: 'api', type: 'ip', window: 60_000, limit: 5 }]);

    mocks.findOneAndUpdate.mockResolvedValue(null);
    mocks.findOne.mockResolvedValue(null);
    mocks.findOneAndUpsert.mockResolvedValue({
      doc: {
        bucket: 'api',
        type: 'ip',
        value: '127.0.0.1',
        windowMs: 60_000,
        windowStart: new Date('2024-01-01T00:01:00.000Z'),
        windowCount: 1,
        prevWindowCount: 0,
        expiresAt: new Date('2024-01-01T00:03:00.000Z'),
      },
      isNew: false,
    });

    await expect(
      consumeRateLimit({ bucket: 'api', type: 'ip', value: '127.0.0.1' })
    ).rejects.toThrow('Rate limit exceeded for api');
  });
});
