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
    logError: vi.fn(),
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

  test.each([
    ['older', 'success'],
    ['older', 'error'],
    ['newer', 'success'],
    ['newer', 'error'],
  ] as const)(
    'cron loop preserves the newer run when the %s run finishes first (%s)',
    async (firstToFinish, outcome) => {
      const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
      let resolveOlderRun!: () => void;
      let rejectOlderRun!: (error: Error) => void;
      let resolveNewerRun!: () => void;
      let rejectNewerRun!: (error: Error) => void;
      const olderRun = new Promise<void>((resolve, reject) => {
        resolveOlderRun = resolve;
        rejectOlderRun = reject;
      });
      const newerRun = new Promise<void>((resolve, reject) => {
        resolveNewerRun = resolve;
        rejectNewerRun = reject;
      });
      const finishOlderRun = () =>
        outcome === 'error' ? rejectOlderRun(new Error('older run failed')) : resolveOlderRun();
      const finishNewerRun = () =>
        outcome === 'error' ? rejectNewerRun(new Error('newer run failed')) : resolveNewerRun();
      const handler = vi
        .fn()
        .mockImplementationOnce(() => olderRun)
        .mockImplementationOnce(() => newerRun)
        .mockResolvedValue(undefined);
      cronStoreMocks.fetch.mockResolvedValue([] as never);
      defineCronJob('overlappingJob', {
        interval: 10_000,
        timeout: 15_000,
        handler,
      });

      try {
        await startCronJobs();
        await intervalCallback?.();
        expect(handler).toHaveBeenCalledTimes(1);

        // Time out the original run, then start its replacement on the next tick.
        nowSpy.mockReturnValue(1_016_000);
        await intervalCallback?.();
        nowSpy.mockReturnValue(1_017_000);
        await intervalCallback?.();
        expect(handler).toHaveBeenCalledTimes(2);

        nowSpy.mockReturnValue(1_018_000);
        (firstToFinish === 'older' ? finishOlderRun : finishNewerRun)();
        await (firstToFinish === 'older' ? olderRun : newerRun).catch(() => {});

        if (firstToFinish === 'older') {
          // The replacement is still running when its next scheduled run becomes due.
          nowSpy.mockReturnValue(1_027_000);
          await intervalCallback?.();
          expect(handler).toHaveBeenCalledTimes(2);

          nowSpy.mockReturnValue(1_028_000);
          finishNewerRun();
          await newerRun.catch(() => {});
          nowSpy.mockReturnValue(1_028_001);
        } else {
          nowSpy.mockReturnValue(1_019_000);
          finishOlderRun();
          await olderRun.catch(() => {});

          // The older run must not move the replacement's next scheduled run forward.
          nowSpy.mockReturnValue(1_026_999);
          await intervalCallback?.();
          expect(handler).toHaveBeenCalledTimes(2);
          nowSpy.mockReturnValue(1_027_000);
        }

        await intervalCallback?.();
        expect(handler).toHaveBeenCalledTimes(3);
      } finally {
        resolveOlderRun();
        resolveNewerRun();
        await Promise.all([olderRun.catch(() => {}), newerRun.catch(() => {})]);
        nowSpy.mockRestore();
      }
    }
  );

  test('cron loop recovers when the lastStartDate write fails', async () => {
    const handler = vi.fn(async () => {});
    cronStoreMocks.fetch.mockResolvedValue([] as never);
    cronStoreMocks.upsertOne.mockRejectedValue(new Error('write failed') as never);
    defineCronJob('hourly', {
      description: '',
      interval: mockSeconds(10),
      handler,
    });

    await startCronJobs();
    await intervalCallback?.();
    await Promise.resolve();
    await Promise.resolve();

    // With the write outside the try/catch, its rejection escaped runCronJob,
    // so the error was never captured and isRunning was left true, wedging the
    // job until its timeout. It must be caught and the run marked as errored.
    expect(mockCaptureError).toHaveBeenCalledWith(expect.any(Error));
    const transaction = mockStartTransaction.mock.results.slice(-1)[0]?.value as { end: Mock };
    expect(transaction.end).toHaveBeenCalledWith('error');
  });

  test('cron loop handles and captures timeout when job runs past its timeout limit', async () => {
    mockCaptureError.mockClear();
    let resolveHandler: () => void;
    const handlerPromise = new Promise<void>((resolve) => {
      resolveHandler = resolve;
    });
    const handler = vi.fn(async () => {
      await handlerPromise;
    });

    cronStoreMocks.fetch.mockResolvedValue([] as never);
    defineCronJob('timeoutJob', {
      interval: mockSeconds(10),
      timeout: 5000,
      handler,
    });

    await startCronJobs();

    const startTs = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(startTs);
    await intervalCallback?.();

    (Date.now as Mock).mockReturnValue(startTs + 6000);
    await intervalCallback?.();

    expect(mockCaptureError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("Cron job 'timeoutJob' timed out after 5000ms"),
      })
    );

    resolveHandler!();
    (Date.now as Mock).mockRestore();
  });
});
