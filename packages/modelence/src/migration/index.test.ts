import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';

const mockAcquireLock = jest.fn();
const mockReleaseLock = jest.fn();
const mockLogInfo = jest.fn();
const mockFetch = jest.fn();
const mockUpsertOne = jest.fn();

jest.unstable_mockModule('@/lock', () => ({
  acquireLock: mockAcquireLock,
  releaseLock: mockReleaseLock,
}));

jest.unstable_mockModule('../telemetry', () => ({
  logInfo: mockLogInfo,
}));

jest.unstable_mockModule('./db', () => ({
  dbMigrations: {
    fetch: mockFetch,
    upsertOne: mockUpsertOne,
  },
}));

const migrationModule = await import('./index');
const { runMigrations, startMigrations } = migrationModule;

describe('migration/index', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAcquireLock.mockResolvedValue(true as never);
    mockFetch.mockResolvedValue([] as never);
    mockUpsertOne.mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('returns immediately when no migrations supplied', async () => {
    await runMigrations([]);

    expect(mockAcquireLock).not.toHaveBeenCalled();
    expect(mockLogInfo).not.toHaveBeenCalled();
  });

  test('skips execution when lock cannot be acquired', async () => {
    mockAcquireLock.mockResolvedValue(false as never);

    await runMigrations([{ version: 1, description: 'one', handler: async () => undefined }]);

    expect(mockAcquireLock).toHaveBeenCalledWith('migrations');
    expect(mockLogInfo).toHaveBeenCalledWith(
      'Another instance is running migrations. Skipping migration run.',
      { source: 'migrations' }
    );
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockReleaseLock).not.toHaveBeenCalled();
  });

  test('executes pending migrations and records completion', async () => {
    const handlerOne = jest.fn(async () => 'ran-one');
    const handlerTwo = jest.fn(async () => 'ran-two');
    mockFetch.mockResolvedValue([{ version: 1 }] as never);

    await runMigrations([
      { version: 1, description: 'first migration', handler: handlerOne },
      { version: 2, description: 'second migration', handler: handlerTwo },
    ]);

    expect(mockFetch).toHaveBeenCalledWith({ version: { $in: [1, 2] } });
    expect(handlerOne).not.toHaveBeenCalled();
    expect(handlerTwo).toHaveBeenCalledTimes(1);
    expect(mockUpsertOne).toHaveBeenCalledWith(
      { version: 2 },
      {
        $set: expect.objectContaining({
          version: 2,
          status: 'completed',
          description: 'second migration',
          output: 'ran-two',
        }),
      }
    );
    expect(mockLogInfo).toHaveBeenCalledWith('Migration v2 complete', {
      source: 'migrations',
    });
    expect(mockReleaseLock).toHaveBeenCalledWith('migrations');
  });

  test('records failed migration attempts', async () => {
    const handler = jest.fn(async () => {
      throw new Error('boom');
    });
    mockFetch.mockResolvedValue([] as never);

    await runMigrations([{ version: 3, description: 'unstable', handler }]);

    expect(handler).toHaveBeenCalled();
    expect(mockUpsertOne).toHaveBeenCalledWith(
      { version: 3 },
      {
        $set: expect.objectContaining({
          version: 3,
          status: 'failed',
          description: 'unstable',
          output: 'boom',
        }),
      }
    );
    expect(mockLogInfo).toHaveBeenCalledWith('Migration v3 is failed: boom', {
      source: 'migrations',
    });
  });

  test('releases lock if unexpected error occurs before migration loop', async () => {
    mockFetch.mockRejectedValue(new Error('db failure') as never);

    await expect(
      runMigrations([{ version: 1, description: 'one', handler: async () => undefined }])
    ).rejects.toThrow('db failure');

    expect(mockReleaseLock).toHaveBeenCalledWith('migrations');
  });

  test('startMigrations schedules execution and logs errors', async () => {
    jest.useFakeTimers();
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockAcquireLock.mockRejectedValue(new Error('lock failure') as never);

    startMigrations([{ version: 1, description: 'one', handler: async () => undefined }]);

    expect(mockAcquireLock).not.toHaveBeenCalled();
    jest.runAllTimers();
    await Promise.resolve();
    await Promise.resolve();

    expect(mockAcquireLock).toHaveBeenCalledWith('migrations');
    expect(consoleError).toHaveBeenCalledWith('Error running migrations:', expect.any(Error));

    consoleError.mockRestore();
  });
});
