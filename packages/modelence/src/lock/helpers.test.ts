import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { MongoError } from 'mongodb';

const mockUpsertOne = jest.fn();
const mockDeleteOne = jest.fn();
const mockFindOne = jest.fn();
const mockLogDebug = jest.fn();
const mockSeconds = jest.fn((value: number) => value * 1000);
const mockRandomBytes = jest.fn(() => ({
  toString: () => 'instance-1',
}));

jest.unstable_mockModule('./db', () => ({
  locksCollection: {
    upsertOne: mockUpsertOne,
    deleteOne: mockDeleteOne,
    findOne: mockFindOne,
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
        _id: 'job',
        $or: [{ instanceId: 'instance-1' }, { acquiredAt: { $lt: new Date(970_000) } }],
      },
      {
        $set: {
          resource: 'job',
          instanceId: 'instance-1',
          acquiredAt: expect.any(Date),
        },
        $setOnInsert: {
          _id: 'job',
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
      _id: 'cleanup',
      instanceId: 'instance-1',
    });
  });

  test('acquireLock falls back to legacy resource query during upgrade collisions', async () => {
    const duplicateResource = new MongoError('dup resource') as MongoError & {
      code: number;
      keyPattern: Record<string, unknown>;
    };
    duplicateResource.code = 11000;
    duplicateResource.keyPattern = { resource: 1 };

    mockUpsertOne
      .mockRejectedValueOnce(duplicateResource as never)
      .mockResolvedValueOnce({ upsertedCount: 1, modifiedCount: 0 } as never);

    const acquired = await acquireLock('legacy');
    expect(acquired).toBe(true);

    expect(mockUpsertOne).toHaveBeenNthCalledWith(
      1,
      {
        _id: 'legacy',
        $or: [{ instanceId: 'instance-1' }, { acquiredAt: { $lt: new Date(970_000) } }],
      },
      {
        $set: {
          resource: 'legacy',
          instanceId: 'instance-1',
          acquiredAt: expect.any(Date),
        },
        $setOnInsert: {
          _id: 'legacy',
        },
      }
    );
    expect(mockUpsertOne).toHaveBeenNthCalledWith(
      2,
      {
        $or: [
          { resource: 'legacy', instanceId: 'instance-1' },
          { resource: 'legacy', acquiredAt: { $lt: new Date(970_000) } },
        ],
      },
      {
        $set: {
          resource: 'legacy',
          instanceId: 'instance-1',
          acquiredAt: expect.any(Date),
        },
      }
    );
  });

  test('acquireLock infers legacy fallback when duplicate key pattern is missing', async () => {
    const duplicateWithoutPattern = new MongoError('dup key') as MongoError & {
      code: number;
    };
    duplicateWithoutPattern.code = 11000;

    mockFindOne.mockResolvedValueOnce({ _id: 'legacy-id', resource: 'legacy-no-pattern' } as never);
    mockUpsertOne
      .mockRejectedValueOnce(duplicateWithoutPattern as never)
      .mockResolvedValueOnce({ upsertedCount: 1, modifiedCount: 0 } as never);

    const acquired = await acquireLock('legacy-no-pattern');
    expect(acquired).toBe(true);
    expect(mockFindOne).toHaveBeenCalledWith({ resource: 'legacy-no-pattern' });
    expect(mockUpsertOne).toHaveBeenCalledTimes(2);
  });

  test('acquireLock caches failed attempts and logs failure when _id lock is held', async () => {
    const duplicateId = new MongoError('dup id') as MongoError & {
      code: number;
      keyPattern: Record<string, unknown>;
    };
    duplicateId.code = 11000;
    duplicateId.keyPattern = { _id: 1 };

    mockUpsertOne.mockRejectedValue(duplicateId as never);

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

  test('releaseLock falls back to legacy deletion for pre-upgrade lock documents', async () => {
    mockDeleteOne
      .mockResolvedValueOnce({ deletedCount: 0 } as never)
      .mockResolvedValueOnce({ deletedCount: 1 } as never);

    const released = await releaseLock('legacy-release');
    expect(released).toBe(true);
    expect(mockDeleteOne).toHaveBeenNthCalledWith(1, {
      _id: 'legacy-release',
      instanceId: 'instance-1',
    });
    expect(mockDeleteOne).toHaveBeenNthCalledWith(2, {
      resource: 'legacy-release',
      instanceId: 'instance-1',
    });
  });

  test('releaseLock returns false when DB operation throws', async () => {
    mockDeleteOne.mockRejectedValue(new Error('delete failed') as never);

    await expect(releaseLock('release-error')).resolves.toBe(false);
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
