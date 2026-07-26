import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Mock, MockInstance } from 'vitest';

const mockSeconds = vi.fn((value: number) => value * 1000);
const mockMinutes = vi.fn((value: number) => value * 60 * 1000);
const mockDays = vi.fn((value: number) => value * 24 * 60 * 60 * 1000);
const mockStartTransaction = vi.fn(() => ({
  end: vi.fn(),
}));
const mockCaptureError = vi.fn();
const mockAcquireLock: Mock = vi.fn();
const mockGetMongodbUri = vi.fn();

const cronStoreMocks: { fetch: Mock; upsertOne: Mock } = {
  fetch: vi.fn(),
  upsertOne: vi.fn(),
};

function registerMocks() {
  vi.doMock('../time', () => ({
    time: {
      seconds: mockSeconds,
      minutes: mockMinutes,
      days: mockDays,
    },
  }));

  vi.doMock('@/telemetry', () => ({
    startTransaction: mockStartTransaction,
    captureError: mockCaptureError,
  }));

  vi.doMock('../data/store', () => ({
    Store: vi.fn().mockImplementation(() => cronStoreMocks),
  }));

  vi.doMock('../lock/helpers', () => ({
    acquireLock: mockAcquireLock,
  }));

  vi.doMock('@/db/client', () => ({
    getMongodbUri: mockGetMongodbUri,
  }));
}

describe('cron/jobs', () => {
  let defineCronJob: typeof import('./jobs').defineCronJob;
  let startCronJobs: typeof import('./jobs').startCronJobs;
  let getCronJobsMetadata: typeof import('./jobs').getCronJobsMetadata;
  let intervalCallback: (() => Promise<void>) | null;
  let intervalDelay: number | undefined;
  let setIntervalMock: MockInstance;

  let consoleErrorSpy: MockInstance;

  beforeEach(async () => {
    vi.resetModules();
    Object.assign(cronStoreMocks, {
      fetch: vi.fn(),
      upsertOne: vi.fn().mockResolvedValue(undefined as never),
    });
    mockGetMongodbUri.mockReturnValue('mongodb://localhost:27017/test');
    mockAcquireLock.mockResolvedValue(true as never);
    intervalCallback = null;
    intervalDelay = undefined;
    setIntervalMock = vi.spyOn(global, 'setInterval').mockImplementation(((
      handler: TimerHandler,
      timeout?: number
    ) => {
      intervalCallback = handler as () => Promise<void>;
      intervalDelay = timeout;
      return 123 as unknown as NodeJS.Timeout;
    }) as unknown as typeof setInterval);
    registerMocks();
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    ({ defineCronJob, startCronJobs, getCronJobsMetadata } = await import('./jobs'));
  });

  afterEach(() => {
    setIntervalMock.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  test('defineCronJob registers metadata and prevents duplicates', () => {
    defineCronJob('nightlyCleanup', {
      description: 'cleanup',
      interval: mockSeconds(10),
      timeout: mockMinutes(2),
      handler: async () => {},
    });

    expect(getCronJobsMetadata()).toEqual([
      {
        alias: 'nightlyCleanup',
        description: 'cleanup',
        interval: 10_000,
        timeout: 120_000,
      },
    ]);

    expect(() =>
      defineCronJob('nightlyCleanup', {
        description: 'duplicate',
        interval: mockSeconds(10),
        handler: async () => {},
      })
    ).toThrow("Duplicate cron job declaration: 'nightlyCleanup' already exists");
  });

  test('startCronJobs initializes schedule, fetches last run, and sets interval', async () => {
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    cronStoreMocks.fetch.mockResolvedValue([] as never);

    defineCronJob('nightlyCleanup', {
      description: 'cleanup',
      interval: mockSeconds(10),
      handler: async () => {},
    });

    await startCronJobs();

    expect(cronStoreMocks.fetch).toHaveBeenCalledWith({
      alias: { $in: ['nightlyCleanup'] },
    });
    expect(intervalDelay).toBe(mockSeconds(1));
    expect(intervalCallback).toBeTruthy();

    await expect(startCronJobs()).rejects.toThrow('Cron jobs already started');
    (Date.now as Mock).mockRestore();
  });

  test('startCronJobs skips starting cron jobs and logs message when MongoDB URI is not set', async () => {
    mockGetMongodbUri.mockReturnValue('');
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    defineCronJob('noDbJob', {
      description: 'no db',
      interval: mockSeconds(10),
      handler: async () => {},
    });

    await startCronJobs();

    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('MongoDB URI is not configured')
    );
    expect(cronStoreMocks.fetch).not.toHaveBeenCalled();
    expect(setIntervalMock).not.toHaveBeenCalled();
    consoleLogSpy.mockRestore();
  });

  test('startCronJobs uses lastStartDate from DB when present to schedule next run', async () => {
    const now = 1_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const lastRun = new Date(now - 5_000);
    cronStoreMocks.fetch.mockResolvedValueOnce([
      { alias: 'existingJob', lastStartDate: lastRun },
    ] as never);

    defineCronJob('existingJob', {
      interval: mockSeconds(10),
      handler: async () => {},
    });

    await startCronJobs();

    expect(cronStoreMocks.fetch).toHaveBeenCalledWith({
      alias: { $in: ['existingJob'] },
    });
    expect(intervalDelay).toBe(mockSeconds(1));
    (Date.now as Mock).mockRestore();
  });

  test('startCronJobs no-ops when no cron jobs defined', async () => {
    await startCronJobs();
    expect(cronStoreMocks.fetch).not.toHaveBeenCalled();
    expect(setIntervalMock).not.toHaveBeenCalled();
  });

  test('cron loop executes job handler and records completion using upsertOne', async () => {
    const handler = vi.fn(async () => {});
    cronStoreMocks.fetch.mockResolvedValue([] as never);
    defineCronJob('hourly', {
      description: '',
      interval: mockSeconds(10),
      handler,
    });

    await startCronJobs();
    await intervalCallback?.();
    await Promise.resolve();

    expect(mockAcquireLock).toHaveBeenCalled();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(cronStoreMocks.upsertOne).toHaveBeenCalledWith(
      { alias: 'hourly' },
      {
        $set: { lastStartDate: expect.any(Date) },
        $setOnInsert: { alias: 'hourly' },
      }
    );
    const transactionCall = (mockStartTransaction as Mock).mock.calls.slice(-1)[0];
    expect(transactionCall).toEqual(['cron', 'cron:hourly']);
    const transaction = mockStartTransaction.mock.results.slice(-1)[0]?.value as { end: Mock };
    expect(transaction.end).toHaveBeenCalledWith('success');
  });

  test('cron loop captures errors and continues schedule', async () => {
    const handler = vi.fn(async () => {
      throw new Error('boom');
    });
    cronStoreMocks.fetch.mockResolvedValue([] as never);
    defineCronJob('hourly', {
      description: '',
      interval: mockSeconds(10),
      handler,
    });

    await startCronJobs();
    await intervalCallback?.();
    await Promise.resolve();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(mockCaptureError).toHaveBeenCalledWith(expect.any(Error));
    const transaction = mockStartTransaction.mock.results.slice(-1)[0]?.value as { end: Mock };
    expect(transaction.end).toHaveBeenCalledWith('error');
  });
});
