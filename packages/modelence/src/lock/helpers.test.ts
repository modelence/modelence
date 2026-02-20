import { beforeEach, describe, expect, jest, test } from '@jest/globals';

const mockUpsertOne = jest.fn();
const mockDeleteOne = jest.fn();
const mockLogDebug = jest.fn();
const mockSeconds = jest.fn((value: number) => value * 1000);
const mockRandomBytes = jest.fn(() => ({
  toString: () => 'instance-1',
}));

jest.unstable_mockModule('./db', () => ({
  locksCollection: {
    upsertOne: mockUpsertOne,
    deleteOne: mockDeleteOne,
  },
}));

jest.unstable_mockModule('../telemetry', () => ({
  logDebug: mockLogDebug,
}));

jest.unstable_mockModule('@/time', () => ({
  time: {
    seconds: mockSeconds,
  },
}));

jest.unstable_mockModule('crypto', () => ({
  randomBytes: mockRandomBytes,
}));

const helpers = await import('./helpers');
const { acquireLock, releaseLock } = helpers;

describe('lock/helpers', () => {
  let dateSpy: jest.SpiedFunction<typeof Date.now>;

  beforeEach(() => {
    jest.clearAllMocks();
    dateSpy = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
  });

  afterEach(() => {
    dateSpy.mockRestore();
  });

  test('acquireLock stores success in cache and skips redundant DB calls', async () => {
    mockUpsertOne.mockResolvedValueOnce({ upsertedCount: 1, modifiedCount: 0 } as never);

    const first = await acquireLock('job');
    expect(first).toBe(true);
    expect(mockUpsertOne).toHaveBeenCalledTimes(1);
    expect(mockUpsertOne).toHaveBeenCalledWith(
      {
        $or: [
          { resource: 'job', instanceId: 'instance-1' },
          { resource: 'job', acquiredAt: { $lt: new Date(970_000) } },
        ],
      },
      {
        $set: {
          resource: 'job',
          instanceId: 'instance-1',
          acquiredAt: expect.any(Date),
        },
      }
    );

    const second = await acquireLock('job');
    expect(second).toBe(true);
    expect(mockUpsertOne).toHaveBeenCalledTimes(1);
    expect(mockLogDebug).toHaveBeenCalledWith('Lock acquired: job', expect.any(Object));
  });

  test('releaseLock removes cache entry and frees lock for future acquisitions', async () => {
    mockUpsertOne
      .mockResolvedValueOnce({ upsertedCount: 1, modifiedCount: 0 } as never)
      .mockResolvedValueOnce({
        upsertedCount: 1,
        modifiedCount: 0,
      } as never);
    mockDeleteOne.mockResolvedValue({ deletedCount: 1 } as never);

    expect(await acquireLock('cleanup')).toBe(true);
    expect(await releaseLock('cleanup')).toBe(true);

    expect(await acquireLock('cleanup')).toBe(true);
    expect(mockUpsertOne).toHaveBeenCalledTimes(2);
    expect(mockDeleteOne).toHaveBeenCalledWith({
      resource: 'cleanup',
      instanceId: 'instance-1',
    });
  });

  test('acquireLock caches failed attempts and logs failure', async () => {
    mockUpsertOne.mockResolvedValue({ upsertedCount: 0, modifiedCount: 0 } as never);

    const first = await acquireLock('busy');
    expect(first).toBe(false);
    expect(mockLogDebug).toHaveBeenCalledWith(
      'Failed to acquire lock (already held): busy',
      expect.objectContaining({ resource: 'busy' })
    );

    const second = await acquireLock('busy');
    expect(second).toBe(false);
    expect(mockUpsertOne).toHaveBeenCalledTimes(1);
  });

  test('acquireLock returns false when DB operation throws', async () => {
    mockUpsertOne.mockRejectedValue(new Error('db down') as never);

    const result = await acquireLock('error');
    expect(result).toBe(false);
    expect(mockLogDebug).toHaveBeenCalledWith(
      'Failed to acquire lock (already held): error',
      expect.objectContaining({ resource: 'error' })
    );
  });
});
