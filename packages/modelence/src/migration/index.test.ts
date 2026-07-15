import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mockAcquireLock = vi.fn();
const mockReleaseLock = vi.fn();
const mockLogInfo = vi.fn();
const mockFetch = vi.fn();
const mockUpsertOne = vi.fn();

vi.doMock('@/lock', () => ({
  acquireLock: mockAcquireLock,
  releaseLock: mockReleaseLock,
}));

vi.doMock('../telemetry', () => ({
  logInfo: mockLogInfo,
  logError: mockLogInfo,
}));

vi.doMock('./db', () => ({
  dbMigrations: {
    fetch: mockFetch,
    upsertOne: mockUpsertOne,
  },
}));

const migrationModule = await import('./index');
const { runMigrations, startMigrations } = migrationModule;

describe('migration/index', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAcquireLock.mockResolvedValue(true as never);
    mockFetch.mockResolvedValue([] as never);
    mockUpsertOne.mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    vi.useRealTimers();
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
    const handlerOne = vi.fn(async () => 'ran-one');
    const handlerTwo = vi.fn(async () => 'ran-two');
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

  test('supports lockMode skip without lock acquire/release', async () => {
    const handler = vi.fn(async () => 'ran');

    await runMigrations([{ version: 4, description: 'skip-lock', handler }], { lockMode: 'skip' });

    expect(mockAcquireLock).not.toHaveBeenCalled();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(mockReleaseLock).not.toHaveBeenCalled();
  });

  test('records failed migration attempts', async () => {
    const handler = vi.fn(async () => {
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
    vi.useFakeTimers();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockAcquireLock.mockRejectedValue(new Error('lock failure') as never);

    startMigrations([{ version: 1, description: 'one', handler: async () => undefined }]);

    expect(mockAcquireLock).not.toHaveBeenCalled();
    vi.runAllTimers();
    await Promise.resolve();
    await Promise.resolve();

    expect(mockAcquireLock).toHaveBeenCalledWith('migrations');
    expect(mockLogInfo).toHaveBeenCalledWith('Migration startup failed', {
      err: expect.any(Error),
    });

    consoleError.mockRestore();
  });
});
