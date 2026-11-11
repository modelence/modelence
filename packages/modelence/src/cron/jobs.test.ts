import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Mock, MockInstance } from 'vitest';

const mockSeconds = vi.fn((value: number) => value * 1000);
const mockMinutes = vi.fn((value: number) => value * 60 * 1000);
const mockHours = vi.fn((value: number) => value * 60 * 60 * 1000);
const mockDays = vi.fn((value: number) => value * 24 * 60 * 60 * 1000);
const mockStartTransaction = vi.fn(() => ({
  end: vi.fn(),
}));
const mockCaptureError = vi.fn();
const mockLogError = vi.fn();
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
      hours: mockHours,
      days: mockDays,
    },
  }));

  vi.doMock('@/telemetry', () => ({
    startTransaction: mockStartTransaction,
    captureError: mockCaptureError,
    logError: mockLogError,
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
    mockLogError.mockClear();
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
    const error = new Error('boom');
    const handler = vi.fn(async () => {
      throw error;
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
    expect(mockLogError).toHaveBeenCalledWith('Error in cron job:', { error, alias: 'hourly' });
    const transaction = mockStartTransaction.mock.results.slice(-1)[0]?.value as { end: Mock };
    expect(transaction.end).toHaveBeenCalledWith('error');
  });

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

  describe('timed-out jobs', () => {
    const startTs = 1_000_000;

    function flushPromises() {
      return new Promise((resolve) => setImmediate(resolve));
    }

    async function tickAt(ts: number) {
      (Date.now as Mock).mockReturnValue(ts);
      await intervalCallback?.();
      // runCronJob calls the handler after awaiting the lastStartDate write.
      await flushPromises();
    }

    function getTimeoutErrors() {
      return mockCaptureError.mock.calls
        .map(([error]) => error)
        .filter((error) => error instanceof Error && error.message.includes('timed out'));
    }

    function countTimeoutErrors() {
      return getTimeoutErrors().length;
    }

    beforeEach(() => {
      mockCaptureError.mockClear();
      vi.spyOn(Date, 'now').mockReturnValue(startTs);
      cronStoreMocks.fetch.mockResolvedValue([] as never);
    });

    afterEach(() => {
      (Date.now as Mock).mockRestore();
    });

    test('are not restarted while their handler is still running', async () => {
      let resolveHandler!: () => void;
      const handlerPromise = new Promise<void>((resolve) => {
        resolveHandler = resolve;
      });
      const handler = vi.fn(() => handlerPromise);
      defineCronJob('hungJob', { interval: mockSeconds(10), timeout: 5000, handler });

      await startCronJobs();
      await tickAt(startTs);
      // Past the timeout, then the next tick, then past the interval twice over.
      for (const offset of [6000, 7000, 11_000, 23_000]) {
        await tickAt(startTs + offset);
      }

      expect(handler).toHaveBeenCalledTimes(1);

      resolveHandler();
      await handlerPromise;
    });

    test('report the timeout once per timeout period while still running', async () => {
      let resolveHandler!: () => void;
      const handlerPromise = new Promise<void>((resolve) => {
        resolveHandler = resolve;
      });
      defineCronJob('hungJob', {
        interval: mockSeconds(10),
        timeout: 5000,
        handler: vi.fn(() => handlerPromise),
      });

      await startCronJobs();
      await tickAt(startTs);
      for (const offset of [6000, 7000, 11_000]) {
        await tickAt(startTs + offset);
      }
      expect(countTimeoutErrors()).toBe(1);

      for (const offset of [12_000, 13_000, 17_000, 18_000]) {
        await tickAt(startTs + offset);
      }
      expect(countTimeoutErrors()).toBe(3);
      expect(getTimeoutErrors().at(-1).message).toContain('still running (18000ms elapsed)');

      resolveHandler();
      await handlerPromise;
    });

    test.each(['success', 'error'] as const)(
      'are rescheduled once their handler finally settles (%s)',
      async (outcome) => {
        let settleFirstRun!: () => void;
        const firstRun = new Promise<void>((resolve, reject) => {
          settleFirstRun = () =>
            outcome === 'error' ? reject(new Error('first run failed')) : resolve();
        });
        let resolveSecondRun!: () => void;
        const secondRun = new Promise<void>((resolve) => {
          resolveSecondRun = resolve;
        });
        const handler = vi
          .fn()
          .mockImplementationOnce(() => firstRun)
          .mockImplementationOnce(() => secondRun);
        defineCronJob('hungJob', { interval: mockSeconds(10), timeout: 5000, handler });

        await startCronJobs();
        await tickAt(startTs);
        await tickAt(startTs + 6000);
        expect(countTimeoutErrors()).toBe(1);

        settleFirstRun();
        await flushPromises();
        // The next run was due at startTs + 10s, so it starts on the next tick.
        await tickAt(startTs + 20_000);
        expect(handler).toHaveBeenCalledTimes(2);

        // The new run gets its own timeout.
        await tickAt(startTs + 26_000);
        expect(countTimeoutErrors()).toBe(2);

        resolveSecondRun();
        await secondRun;
      }
    );

    test.each([
      ['success', 'timeout'],
      ['error', 'error'],
    ] as const)(
      'end a run that settles with %s after timing out as %s',
      async (outcome, expectedResult) => {
        let settleHandler!: () => void;
        const handlerPromise = new Promise<void>((resolve, reject) => {
          settleHandler = () => (outcome === 'error' ? reject(new Error('run failed')) : resolve());
        });
        defineCronJob('hungJob', {
          interval: mockSeconds(10),
          timeout: 5000,
          handler: vi.fn(() => handlerPromise),
        });

        await startCronJobs();
        await tickAt(startTs);
        await tickAt(startTs + 6000);

        settleHandler();
        await flushPromises();

        const transaction = mockStartTransaction.mock.results.slice(-1)[0]?.value as { end: Mock };
        expect(transaction.end).toHaveBeenCalledWith(expectedResult);
      }
    );
  });

  describe('lock acquisition and standby takeover', () => {
    test('refreshes schedule on lock takeover and skips jobs run recently by previous owner', async () => {
      const startTs = 1_000_000;
      vi.spyOn(Date, 'now').mockReturnValue(startTs);
      const handler = vi.fn(async () => {});

      // At startup, instance is standby (does not acquire lock)
      mockAcquireLock.mockResolvedValue(false);
      // Last run was 23 hours ago (job was due at startTs + 1 hour)
      const initialLastRun = new Date(startTs - mockHours(23));
      cronStoreMocks.fetch.mockResolvedValueOnce([
        { alias: 'dailyJob', lastStartDate: initialLastRun },
      ] as never);

      defineCronJob('dailyJob', {
        interval: mockDays(1),
        handler,
      });

      await startCronJobs();
      expect(cronStoreMocks.fetch).toHaveBeenCalledTimes(1);

      // Advance time by 2 hours. In between, the active instance ran the job
      // at startTs + 1 hour and recorded its start date in the DB.
      const takeoverTs = startTs + mockHours(2);
      (Date.now as Mock).mockReturnValue(takeoverTs);
      const activeInstanceRunDate = new Date(startTs + mockHours(1));
      cronStoreMocks.fetch.mockResolvedValueOnce([
        { alias: 'dailyJob', lastStartDate: activeInstanceRunDate },
      ] as never);

      // Now this instance acquires the lock (takes over)
      mockAcquireLock.mockResolvedValue(true);
      await intervalCallback?.();
      await Promise.resolve();

      // DB should be queried again on takeover to refresh the schedule
      expect(cronStoreMocks.fetch).toHaveBeenCalledTimes(2);
      // Handler must NOT have been called because the job ran only 1 hour ago
      // and interval is 24 hours (next run is due at startTs + 25 hours)
      expect(handler).not.toHaveBeenCalled();
      expect(cronStoreMocks.upsertOne).not.toHaveBeenCalled();

      (Date.now as Mock).mockRestore();
    });

    test('refreshes schedule on lock takeover and runs overdue jobs', async () => {
      const startTs = 1_000_000;
      vi.spyOn(Date, 'now').mockReturnValue(startTs);
      const handler = vi.fn(async () => {});

      // At startup, instance is standby
      mockAcquireLock.mockResolvedValue(false);
      cronStoreMocks.fetch.mockResolvedValueOnce([] as never);

      defineCronJob('hourlyJob', {
        interval: mockHours(1),
        handler,
      });

      await startCronJobs();
      expect(cronStoreMocks.fetch).toHaveBeenCalledTimes(1);

      // Advance time by 3 hours. Previous owner ran it at startTs + 1 hour.
      // Next run was due at startTs + 2 hours, so at startTs + 3 hours it is overdue!
      const takeoverTs = startTs + mockHours(3);
      (Date.now as Mock).mockReturnValue(takeoverTs);
      const previousOwnerRunDate = new Date(startTs + mockHours(1));
      cronStoreMocks.fetch.mockResolvedValueOnce([
        { alias: 'hourlyJob', lastStartDate: previousOwnerRunDate },
      ] as never);

      mockAcquireLock.mockResolvedValue(true);
      await intervalCallback?.();
      await Promise.resolve();

      expect(cronStoreMocks.fetch).toHaveBeenCalledTimes(2);
      expect(handler).toHaveBeenCalledTimes(1);
      expect(cronStoreMocks.upsertOne).toHaveBeenCalledWith(
        { alias: 'hourlyJob' },
        {
          $set: { lastStartDate: expect.any(Date) },
          $setOnInsert: { alias: 'hourlyJob' },
        }
      );

      (Date.now as Mock).mockRestore();
    });

    test('does not re-query DB on subsequent ticks while retaining the lock', async () => {
      const startTs = 1_000_000;
      vi.spyOn(Date, 'now').mockReturnValue(startTs);
      const handler = vi.fn(async () => {});

      mockAcquireLock.mockResolvedValue(true);
      cronStoreMocks.fetch.mockResolvedValue([
        { alias: 'tenSecondJob', lastStartDate: new Date(startTs) },
      ] as never);

      defineCronJob('tenSecondJob', {
        interval: mockSeconds(10),
        handler,
      });

      await startCronJobs();
      expect(cronStoreMocks.fetch).toHaveBeenCalledTimes(1);

      // Tick 1: acquires lock, refreshes schedule
      await intervalCallback?.();
      expect(cronStoreMocks.fetch).toHaveBeenCalledTimes(2);

      // Tick 2: still owns lock, should NOT refresh schedule from DB
      (Date.now as Mock).mockReturnValue(startTs + 1000);
      await intervalCallback?.();
      expect(cronStoreMocks.fetch).toHaveBeenCalledTimes(2);

      // Tick 3: still owns lock, should NOT refresh schedule from DB
      (Date.now as Mock).mockReturnValue(startTs + 2000);
      await intervalCallback?.();
      expect(cronStoreMocks.fetch).toHaveBeenCalledTimes(2);

      (Date.now as Mock).mockRestore();
    });

    test('re-queries DB if lock was lost and re-acquired', async () => {
      const startTs = 1_000_000;
      vi.spyOn(Date, 'now').mockReturnValue(startTs);
      const handler = vi.fn(async () => {});

      mockAcquireLock.mockResolvedValue(true);
      cronStoreMocks.fetch.mockResolvedValue([
        { alias: 'tenSecondJob', lastStartDate: new Date(startTs) },
      ] as never);

      defineCronJob('tenSecondJob', {
        interval: mockSeconds(10),
        handler,
      });

      await startCronJobs();
      expect(cronStoreMocks.fetch).toHaveBeenCalledTimes(1);

      // Tick 1: owns lock, initial refresh
      await intervalCallback?.();
      expect(cronStoreMocks.fetch).toHaveBeenCalledTimes(2);

      // Tick 2: lock is lost
      mockAcquireLock.mockResolvedValue(false);
      await intervalCallback?.();
      expect(cronStoreMocks.fetch).toHaveBeenCalledTimes(2);

      // Tick 3: lock is re-acquired, should refresh again
      mockAcquireLock.mockResolvedValue(true);
      await intervalCallback?.();
      expect(cronStoreMocks.fetch).toHaveBeenCalledTimes(3);

      (Date.now as Mock).mockRestore();
    });

    test('handles schedule refresh failure gracefully on lock takeover', async () => {
      const startTs = 1_000_000;
      vi.spyOn(Date, 'now').mockReturnValue(startTs);
      const handler = vi.fn(async () => {});

      mockAcquireLock.mockResolvedValue(false);
      cronStoreMocks.fetch.mockResolvedValueOnce([] as never);

      defineCronJob('failingJob', {
        interval: mockSeconds(10),
        handler,
      });

      await startCronJobs();
      expect(cronStoreMocks.fetch).toHaveBeenCalledTimes(1);

      // Takeover fails when fetching from DB
      mockAcquireLock.mockResolvedValue(true);
      const dbError = new Error('DB connection failed');
      cronStoreMocks.fetch.mockRejectedValueOnce(dbError as never);

      await intervalCallback?.();

      expect(mockCaptureError).toHaveBeenCalledWith(dbError);
      expect(mockLogError).toHaveBeenCalledWith(
        'Error refreshing cron schedule on lock takeover:',
        { error: dbError }
      );
      // Handler was not run because refresh failed
      expect(handler).not.toHaveBeenCalled();

      // On next tick, DB recovers and refresh succeeds
      cronStoreMocks.fetch.mockResolvedValueOnce([
        { alias: 'failingJob', lastStartDate: new Date(startTs) },
      ] as never);
      await intervalCallback?.();
      expect(cronStoreMocks.fetch).toHaveBeenCalledTimes(3);

      (Date.now as Mock).mockRestore();
    });

    test('prevents overlapping ticks while schedule refresh is in-flight on lock takeover', async () => {
      const startTs = 1_000_000;
      vi.spyOn(Date, 'now').mockReturnValue(startTs);
      const handler = vi.fn(async () => {});

      mockAcquireLock.mockResolvedValue(true);
      cronStoreMocks.fetch.mockResolvedValueOnce([] as never);

      defineCronJob('overlapJob', {
        interval: mockSeconds(10),
        handler,
      });

      await startCronJobs();
      expect(cronStoreMocks.fetch).toHaveBeenCalledTimes(1);

      // On tick 1, refreshCronSchedule returns a pending promise
      let finishRefresh!: (records: unknown[]) => void;
      cronStoreMocks.fetch.mockReturnValueOnce(
        new Promise((resolve) => {
          finishRefresh = resolve;
        }) as never
      );

      const tick1Promise = intervalCallback?.();

      // Tick 2 fires while Tick 1's refresh is still in-flight
      await intervalCallback?.();

      // Tick 2 should not have called fetch again due to re-entrancy guard
      expect(cronStoreMocks.fetch).toHaveBeenCalledTimes(2);

      // Complete Tick 1's refresh
      finishRefresh([]);
      await tick1Promise;
      await Promise.resolve();

      expect(handler).toHaveBeenCalledTimes(1);

      (Date.now as Mock).mockRestore();
    });

    test('defers job dispatch if refresh on lock takeover outlasts the lock cache duration', async () => {
      const startTs = 1_000_000;
      const clock = vi.spyOn(Date, 'now').mockReturnValue(startTs);
      const handler = vi.fn(async () => {});

      mockAcquireLock.mockResolvedValue(true);
      cronStoreMocks.fetch.mockResolvedValueOnce([] as never);

      defineCronJob('slowRefreshJob', {
        interval: mockSeconds(10),
        handler,
      });

      await startCronJobs();
      expect(cronStoreMocks.fetch).toHaveBeenCalledTimes(1);

      // Refresh on takeover takes longer than 10s (CRON_LOCK_CACHE_DURATION)
      let finishSlowRefresh!: (records: unknown[]) => void;
      cronStoreMocks.fetch.mockReturnValueOnce(
        new Promise((resolve) => {
          finishSlowRefresh = resolve;
        }) as never
      );

      const tick1Promise = intervalCallback?.();

      // Advance clock past 10 seconds while refresh is running
      clock.mockReturnValue(startTs + 10_000);
      finishSlowRefresh([]);
      await tick1Promise;
      await Promise.resolve();

      // Job handler should NOT have been dispatched because lock may have expired
      expect(handler).not.toHaveBeenCalled();

      // Next tick re-evaluates and runs
      cronStoreMocks.fetch.mockResolvedValueOnce([] as never);
      await intervalCallback?.();
      await Promise.resolve();
      expect(handler).toHaveBeenCalledTimes(1);

      clock.mockRestore();
    });
  });
});
