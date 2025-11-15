import { afterEach, describe, expect, jest, test } from '@jest/globals';

type SetupResult = {
  initRateLimits: typeof import('./rules').initRateLimits;
  consumeRateLimit: typeof import('./rules').consumeRateLimit;
  mocks: {
    findOne: jest.Mock;
    upsertOne: jest.Mock;
  };
};

async function loadModule(): Promise<SetupResult> {
  jest.resetModules();

  const mockFindOne = jest.fn();
  const mockUpsertOne = jest.fn();

  jest.unstable_mockModule('./db', () => ({
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
    jest.useRealTimers();
  });

  test('initRateLimits throws on duplicate initialization', async () => {
    const { initRateLimits } = await loadModule();

    initRateLimits([{ bucket: 'api', type: 'ip', window: 1000, limit: 10 }]);

    expect(() => initRateLimits([{ bucket: 'api', type: 'ip', window: 1000, limit: 10 }])).toThrow(
      'Duplicate call to initRateLimits - already initialized'
    );
  });

  test('consumeRateLimit inserts new record when no existing entry', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
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
    jest.useFakeTimers().setSystemTime(new Date('2024-01-01T00:01:00.000Z'));
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
});
