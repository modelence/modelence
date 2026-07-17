import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Mock, MockInstance } from 'vitest';
import { MongoError } from 'mongodb';

const mockSeconds = vi.fn((value: number) => value * 1000);
const mockMinutes = vi.fn((value: number) => value * 60 * 1000);
const mockDays = vi.fn((value: number) => value * 24 * 60 * 60 * 1000);
const mockStartTransaction = vi.fn(() => ({
  end: vi.fn(),
}));
const mockCaptureError = vi.fn();
const mockAcquireLock: Mock = vi.fn();
const mockGetMongodbUri: Mock = vi.fn();

const cronStoreMocks: {
  fetch: Mock;
  updateOne: Mock;
  upsertOne: Mock;
  insertMany: Mock;
  findOne: Mock;
  requireCollection: Mock;
} = {
  fetch: vi.fn(),
  updateOne: vi.fn(),
  upsertOne: vi.fn(),
  insertMany: vi.fn(),
  findOne: vi.fn(),
  requireCollection: vi.fn(),
};

const lockStoreMocks: {
  fetch: Mock;
  updateOne: Mock;
  upsertOne: Mock;
  insertMany: Mock;
  findOne: Mock;
  requireCollection: Mock;
} = {
  fetch: vi.fn(),
  updateOne: vi.fn(),
  upsertOne: vi.fn(),
  insertMany: vi.fn(),
  findOne: vi.fn(),
  requireCollection: vi.fn(),
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
    Store: vi.fn().mockImplementation(function (name: string) {
      if (name === '_modelenceLocks') {
        return lockStoreMocks;
      }
      return cronStoreMocks;
    }),
  }));

  vi.doMock('../lock/helpers', () => ({
    acquireLock: mockAcquireLock,
    INSTANCE_ID: 'instance-1',
    isDuplicateKeyError: (error: unknown) =>
      typeof error === 'object' &&
      error !== null &&
      (error as Record<string, unknown>).code === 11000,
  }));

  vi.doMock('@/db/client', () => ({
    getMongodbUri: mockGetMongodbUri,
  }));
}

describe('cron/jobs', () => {
  let defineCronJob: typeof import('./jobs').defineCronJob;
  let startCronJobs: typeof import('./jobs').startCronJobs;
  let getCronJobsMetadata: typeof import('./jobs').getCronJobsMetadata;
  let registerNewCronJobs: typeof import('./jobs').registerNewCronJobs;
  let intervalCallback: (() => Promise<void>) | null;
  let intervalDelay: number | undefined;
  let setIntervalMock: MockInstance;

  let consoleErrorSpy: MockInstance;

  beforeEach(async () => {
    vi.resetModules();
    Object.assign(cronStoreMocks, {
      fetch: vi.fn(),
      updateOne: vi.fn().mockResolvedValue(undefined as never),
      upsertOne: vi.fn().mockResolvedValue(undefined as never),
      insertMany: vi.fn().mockResolvedValue(undefined as never),
      findOne: vi.fn().mockResolvedValue(null as never),
      requireCollection: vi.fn().mockReturnValue(cronStoreMocks),
    });
    Object.assign(lockStoreMocks, {
      fetch: vi.fn(),
      updateOne: vi.fn().mockResolvedValue(undefined as never),
      upsertOne: vi.fn().mockResolvedValue(undefined as never),
      insertMany: vi.fn().mockResolvedValue(undefined as never),
      findOne: vi.fn().mockResolvedValue(null as never),
      requireCollection: vi.fn().mockReturnValue(lockStoreMocks),
    });
    mockGetMongodbUri.mockReturnValue('');
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
    ({ defineCronJob, startCronJobs, getCronJobsMetadata, registerNewCronJobs } = await import(
      './jobs'
    ));
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
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    try {
      mockGetMongodbUri.mockReturnValue('mongodb://localhost:27017/test');
      const now = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(now);
      cronStoreMocks.fetch
        .mockResolvedValueOnce([{ alias: 'nightlyCleanup' }] as never)
        .mockResolvedValueOnce([] as never);

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
    } finally {
      vi.useRealTimers();
    }
  });

  test('startCronJobs skips DB wait and schedules immediately when no MongoDB URI', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    try {
      mockGetMongodbUri.mockReturnValue('');
      const now = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(now);

      defineCronJob('noDbJob', {
        description: 'no db',
        interval: mockSeconds(10),
        handler: async () => {},
      });

      await startCronJobs();

      // Should not call fetch (no DB available)
      expect(cronStoreMocks.fetch).not.toHaveBeenCalled();
      // Should still set up the interval
      expect(intervalDelay).toBe(mockSeconds(1));
      expect(intervalCallback).toBeTruthy();
      (Date.now as Mock).mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });

  test('startCronJobs no-ops when no cron jobs defined', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    try {
      await startCronJobs();
      expect(cronStoreMocks.fetch).not.toHaveBeenCalled();
      expect(setIntervalMock).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  test('cron loop executes job handler and records completion', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    try {
      mockGetMongodbUri.mockReturnValue('mongodb://localhost:27017/test');
      const handler = vi.fn(async () => {});
      cronStoreMocks.fetch
        .mockResolvedValueOnce([{ alias: 'hourly' }] as never)
        .mockResolvedValueOnce([] as never);
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
    } finally {
      vi.useRealTimers();
    }
  });

  test('cron loop captures errors and continues schedule', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    try {
      mockGetMongodbUri.mockReturnValue('mongodb://localhost:27017/test');
      const handler = vi.fn(async () => {
        throw new Error('boom');
      });
      cronStoreMocks.fetch
        .mockResolvedValueOnce([{ alias: 'hourly' }] as never)
        .mockResolvedValueOnce([] as never);
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
    } finally {
      vi.useRealTimers();
    }
  });

  describe('registerNewCronJobs', () => {
    test('no-ops when no cron jobs are defined but still updates lock status', async () => {
      await registerNewCronJobs();

      expect(cronStoreMocks.fetch).not.toHaveBeenCalled();
      expect(cronStoreMocks.insertMany).not.toHaveBeenCalled();
      expect(lockStoreMocks.updateOne).toHaveBeenCalledWith(
        { _id: 'migrations', instanceId: 'instance-1' },
        { $set: { status: 'cron_registered' } }
      );
    });

    test('inserts only jobs that are not already in the DB', async () => {
      defineCronJob('existingJob', {
        interval: mockSeconds(10),
        handler: async () => {},
      });
      defineCronJob('newJob', {
        interval: mockSeconds(10),
        handler: async () => {},
      });
      cronStoreMocks.fetch.mockResolvedValue([{ alias: 'existingJob' }] as never);

      await registerNewCronJobs();

      expect(cronStoreMocks.fetch).toHaveBeenCalledWith({
        alias: { $in: expect.arrayContaining(['existingJob', 'newJob']) },
      });
      expect(cronStoreMocks.insertMany).toHaveBeenCalledWith([{ alias: 'newJob' }], {
        ordered: false,
      });
    });

    test('does not call insertMany when all jobs are already registered', async () => {
      defineCronJob('alreadyRegistered', {
        interval: mockSeconds(10),
        handler: async () => {},
      });
      cronStoreMocks.fetch.mockResolvedValue([{ alias: 'alreadyRegistered' }] as never);

      await registerNewCronJobs();

      expect(cronStoreMocks.insertMany).not.toHaveBeenCalled();
    });

    test('updates lock status to cron_registered on success', async () => {
      defineCronJob('myJob', {
        interval: mockSeconds(10),
        handler: async () => {},
      });
      cronStoreMocks.fetch.mockResolvedValue([] as never);

      await registerNewCronJobs();

      expect(lockStoreMocks.updateOne).toHaveBeenCalledWith(
        { _id: 'migrations', instanceId: 'instance-1' },
        { $set: { status: 'cron_registered' } }
      );
    });

    test('updates lock status to cron_registration_failed when operation throws', async () => {
      defineCronJob('myJob', {
        interval: mockSeconds(10),
        handler: async () => {},
      });
      cronStoreMocks.fetch.mockRejectedValue(new Error('fetch failed') as never);

      await expect(registerNewCronJobs()).rejects.toThrow('fetch failed');

      expect(lockStoreMocks.updateOne).toHaveBeenCalledWith(
        { _id: 'migrations', instanceId: 'instance-1' },
        { $set: { status: 'cron_registration_failed' } }
      );
    });

    test('rethrows when fetch throws', async () => {
      defineCronJob('myJob', {
        interval: mockSeconds(10),
        handler: async () => {},
      });
      const fetchError = new Error('DB fetch failed');
      cronStoreMocks.fetch.mockRejectedValue(fetchError as never);

      await expect(registerNewCronJobs()).rejects.toThrow('DB fetch failed');
    });

    test('rethrows when insertMany throws', async () => {
      defineCronJob('myJob', {
        interval: mockSeconds(10),
        handler: async () => {},
      });
      cronStoreMocks.fetch.mockResolvedValue([] as never);
      const insertError = new Error('DB insert failed');
      cronStoreMocks.insertMany.mockRejectedValue(insertError as never);

      await expect(registerNewCronJobs()).rejects.toThrow('DB insert failed');
    });

    test('ignores duplicate key errors (code 11000) thrown by insertMany', async () => {
      defineCronJob('myJob', {
        interval: mockSeconds(10),
        handler: async () => {},
      });
      cronStoreMocks.fetch.mockResolvedValue([] as never);
      const dupError = new MongoError('duplicate key');
      dupError.code = 11000;
      cronStoreMocks.insertMany.mockRejectedValue(dupError as never);

      await expect(registerNewCronJobs()).resolves.toBeUndefined();
      expect(lockStoreMocks.updateOne).toHaveBeenCalledWith(
        { _id: 'migrations', instanceId: 'instance-1' },
        { $set: { status: 'cron_registered' } }
      );
    });
  });

  describe('startCronJobs early termination', () => {
    test('stops polling early when lock status is cron_registered', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout'] });
      try {
        mockGetMongodbUri.mockReturnValue('mongodb://localhost:27017/test');
        const now = Date.now();
        vi.spyOn(Date, 'now').mockReturnValue(now);

        defineCronJob('myJob', {
          interval: mockSeconds(10),
          handler: async () => {},
        });

        // Lock doc has terminal status — registration is done
        lockStoreMocks.findOne.mockResolvedValue({
          _id: 'migrations',
          status: 'cron_registered',
        } as never);

        // Next fetch: for actual job scheduling
        cronStoreMocks.fetch.mockResolvedValueOnce([] as never);

        await startCronJobs();

        // findOne on locksCollection, then fetch on cronJobsCollection for scheduling
        expect(lockStoreMocks.findOne).toHaveBeenCalledWith({ _id: 'migrations' });
        expect(cronStoreMocks.fetch).toHaveBeenCalledTimes(1);
        (Date.now as Mock).mockRestore();
      } finally {
        vi.useRealTimers();
      }
    });

    test('stops polling early when lock status is cron_registration_failed', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout'] });
      try {
        mockGetMongodbUri.mockReturnValue('mongodb://localhost:27017/test');
        const now = Date.now();
        vi.spyOn(Date, 'now').mockReturnValue(now);

        defineCronJob('myJob', {
          interval: mockSeconds(10),
          handler: async () => {},
        });

        // Lock doc has failed status — registration failed but we should still stop waiting
        lockStoreMocks.findOne.mockResolvedValue({
          _id: 'migrations',
          status: 'cron_registration_failed',
        } as never);

        // Next fetches: for warning check and actual job scheduling
        cronStoreMocks.fetch.mockResolvedValue([] as never);

        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

        await startCronJobs();

        expect(lockStoreMocks.findOne).toHaveBeenCalledWith({ _id: 'migrations' });
        expect(cronStoreMocks.fetch).toHaveBeenCalledTimes(2);
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining('Timed out or failed waiting for cron job registration')
        );
        warnSpy.mockRestore();
        (Date.now as Mock).mockRestore();
      } finally {
        vi.useRealTimers();
      }
    });

    test('keeps polling when lock status is still acquired (in progress)', async () => {
      mockSeconds.mockReturnValue(1);
      try {
        mockGetMongodbUri.mockReturnValue('mongodb://localhost:27017/test');
        const now = Date.now();
        vi.spyOn(Date, 'now').mockReturnValue(now);

        defineCronJob('myJob', {
          interval: mockSeconds(10),
          handler: async () => {},
        });

        // First poll: lock is still acquired (registration in progress)
        // Second poll: lock status is cron_registered
        lockStoreMocks.findOne
          .mockResolvedValueOnce({ _id: 'migrations', status: 'acquired' } as never)
          .mockResolvedValueOnce({ _id: 'migrations', status: 'cron_registered' } as never);

        // First poll: job not yet in DB (triggers next poll)
        // After exit: fetch for scheduling
        cronStoreMocks.fetch.mockResolvedValueOnce([] as never).mockResolvedValueOnce([] as never);

        await startCronJobs();

        // 1st findOne (acquired, keeps polling) + 2nd findOne (cron_registered, exits)
        expect(lockStoreMocks.findOne).toHaveBeenCalledTimes(2);
        (Date.now as Mock).mockRestore();
      } finally {
        mockSeconds.mockImplementation((value: number) => value * 1000);
      }
    });

    test('stops polling early when lock is released (null)', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout'] });
      try {
        mockGetMongodbUri.mockReturnValue('mongodb://localhost:27017/test');
        const now = Date.now();
        vi.spyOn(Date, 'now').mockReturnValue(now);

        defineCronJob('myJob', {
          interval: mockSeconds(10),
          handler: async () => {},
        });

        // No lock document — lock was already released/deleted
        lockStoreMocks.findOne.mockResolvedValue(null as never);

        // Next fetches: for warning check and actual job scheduling
        cronStoreMocks.fetch.mockResolvedValue([] as never);

        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

        await startCronJobs();

        expect(lockStoreMocks.findOne).toHaveBeenCalledWith({ _id: 'migrations' });
        expect(cronStoreMocks.fetch).toHaveBeenCalledTimes(2);
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining('Timed out or failed waiting for cron job registration')
        );
        warnSpy.mockRestore();
        (Date.now as Mock).mockRestore();
      } finally {
        vi.useRealTimers();
      }
    });

    test('stops polling early when all aliases are already in the DB', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout'] });
      try {
        mockGetMongodbUri.mockReturnValue('mongodb://localhost:27017/test');
        const now = Date.now();
        vi.spyOn(Date, 'now').mockReturnValue(now);

        defineCronJob('myJob', {
          interval: mockSeconds(10),
          handler: async () => {},
        });

        // Lock is still acquired (registration in progress)
        lockStoreMocks.findOne.mockResolvedValue({
          _id: 'migrations',
          status: 'acquired',
        } as never);

        // But the alias is already in the DB (fast-path)
        cronStoreMocks.fetch
          .mockResolvedValueOnce([{ alias: 'myJob' }] as never)
          .mockResolvedValueOnce([{ alias: 'myJob' }] as never);

        await startCronJobs();

        expect(lockStoreMocks.findOne).toHaveBeenCalledTimes(1);
        expect(cronStoreMocks.fetch).toHaveBeenCalledTimes(2);
        (Date.now as Mock).mockRestore();
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
