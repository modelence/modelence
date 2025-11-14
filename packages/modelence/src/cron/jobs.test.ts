import { beforeEach, describe, expect, jest, test } from '@jest/globals';

const mockSeconds = jest.fn((value: number) => value * 1000);
const mockMinutes = jest.fn((value: number) => value * 60 * 1000);
const mockDays = jest.fn((value: number) => value * 24 * 60 * 60 * 1000);
const mockStartTransaction = jest.fn(() => ({
  end: jest.fn(),
}));
const mockCaptureError = jest.fn();
const mockAcquireLock: jest.Mock = jest.fn();

const cronStoreMocks: { fetch: jest.Mock; updateOne: jest.Mock } = {
  fetch: jest.fn(),
  updateOne: jest.fn(),
};

function registerMocks() {
  jest.unstable_mockModule('../time', () => ({
    time: {
      seconds: mockSeconds,
      minutes: mockMinutes,
      days: mockDays,
    },
  }));

  jest.unstable_mockModule('@/telemetry', () => ({
    startTransaction: mockStartTransaction,
    captureError: mockCaptureError,
  }));

  jest.unstable_mockModule('../data/store', () => ({
    Store: jest.fn().mockImplementation(() => cronStoreMocks),
  }));

  jest.unstable_mockModule('../lock/helpers', () => ({
    acquireLock: mockAcquireLock,
  }));
}

describe('cron/jobs', () => {
  let defineCronJob: typeof import('./jobs').defineCronJob;
  let startCronJobs: typeof import('./jobs').startCronJobs;
  let getCronJobsMetadata: typeof import('./jobs').getCronJobsMetadata;
  let intervalCallback: (() => Promise<void>) | null;
  let intervalDelay: number | undefined;
  let setIntervalMock: ReturnType<typeof jest.spyOn>;

  let consoleErrorSpy: ReturnType<typeof jest.spyOn>;

  beforeEach(async () => {
    jest.resetModules();
    Object.assign(cronStoreMocks, {
      fetch: jest.fn(),
      updateOne: jest.fn().mockResolvedValue(undefined as never),
    });
    mockAcquireLock.mockResolvedValue(true as never);
    intervalCallback = null;
    intervalDelay = undefined;
    setIntervalMock = jest.spyOn(global, 'setInterval').mockImplementation(((handler: TimerHandler, timeout?: number) => {
      intervalCallback = handler as () => Promise<void>;
      intervalDelay = timeout;
      return 123 as unknown as NodeJS.Timeout;
    }) as unknown as typeof setInterval);
    registerMocks();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
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
    jest.spyOn(Date, 'now').mockReturnValue(now);
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
    (Date.now as jest.Mock).mockRestore();
  });

  test('startCronJobs no-ops when no cron jobs defined', async () => {
    await startCronJobs();
    expect(cronStoreMocks.fetch).not.toHaveBeenCalled();
    expect(setIntervalMock).not.toHaveBeenCalled();
  });
  test('cron loop executes job handler and records completion', async () => {
    const handler = jest.fn(async () => {});
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
    expect(cronStoreMocks.updateOne).toHaveBeenCalledWith(
      { alias: 'hourly' },
      {
        $set: { lastStartDate: expect.any(Date) },
      }
    );
    const transactionCall = (mockStartTransaction as jest.Mock).mock.calls.slice(-1)[0];
    expect(transactionCall).toEqual(['cron', 'cron:hourly']);
    const transaction = mockStartTransaction.mock.results.slice(-1)[0]?.value as { end: jest.Mock };
    expect(transaction.end).toHaveBeenCalledWith('success');
  });

  test('cron loop captures errors and continues schedule', async () => {
    const handler = jest.fn(async () => {
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
    const transaction = mockStartTransaction.mock.results.slice(-1)[0]?.value as { end: jest.Mock };
    expect(transaction.end).toHaveBeenCalledWith('error');
  });
});
