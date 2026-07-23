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
      ((error as Record<string, unknown>).code === 11000 ||
        (Array.isArray((error as Record<string, unknown>).writeErrors) &&
          ((error as Record<string, unknown>).writeErrors as Array<{ code?: number }>).some(
            (e) => e?.code === 11000
          ))),
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
  });

  test('startCronJobs uses lastStartDate from DB when present to schedule next run', async () => {
    mockGetMongodbUri.mockReturnValue('mongodb://localhost:27017/test');
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

  test('startCronJobs schedules immediately when no MongoDB URI', async () => {
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
  });

  test('startCronJobs no-ops when no cron jobs defined', async () => {
    await startCronJobs();
    expect(cronStoreMocks.fetch).not.toHaveBeenCalled();
    expect(setIntervalMock).not.toHaveBeenCalled();
  });

  test('cron loop executes job handler and records completion', async () => {
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
  });

  test('cron loop captures errors and continues schedule', async () => {
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
  });

  describe('registerNewCronJobs', () => {
    test('no-ops when no cron jobs are defined', async () => {
      await registerNewCronJobs();

      expect(cronStoreMocks.fetch).not.toHaveBeenCalled();
      expect(cronStoreMocks.insertMany).not.toHaveBeenCalled();
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
    });

    test('ignores MongoBulkWriteError with writeErrors containing code 11000 thrown by insertMany', async () => {
      defineCronJob('myJob2', {
        interval: mockSeconds(10),
        handler: async () => {},
      });
      cronStoreMocks.fetch.mockResolvedValue([] as never);
      const bulkError = new MongoError('bulk write duplicate key') as MongoError & {
        writeErrors: Array<{ code: number }>;
      };
      bulkError.writeErrors = [{ code: 11000 }];
      cronStoreMocks.insertMany.mockRejectedValue(bulkError as never);

      await expect(registerNewCronJobs()).resolves.toBeUndefined();
    });
  });
});
