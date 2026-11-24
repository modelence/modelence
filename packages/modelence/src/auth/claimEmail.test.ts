import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { MockedFunction } from 'vitest';
import { ObjectId } from 'mongodb';
import type { usersCollection } from './db';

type UsersCollection = typeof usersCollection;

const mockUsersFindOneAndUpdate: MockedFunction<UsersCollection['findOneAndUpdate']> = vi.fn();
const mockInvalidateAllUserSessions = vi.fn(async (_userId: unknown) => {});

vi.doMock('./db', () => ({
  usersCollection: { findOneAndUpdate: mockUsersFindOneAndUpdate },
}));

vi.doMock('./session', () => ({
  invalidateAllUserSessions: mockInvalidateAllUserSessions,
}));

const { claimUnverifiedEmail } = await import('./claimEmail');

describe('auth/claimEmail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('verifies the address and drops every auth method in one write, only while unverified', async () => {
    const userId = new ObjectId();
    mockUsersFindOneAndUpdate.mockResolvedValue({ _id: userId } as never);

    await claimUnverifiedEmail(userId, 'user@example.com');

    // `$elemMatch` keeps "this address" and "still unverified" on one element,
    // so a concurrent proof of ownership makes the write match nothing. The
    // strength-2 collation matches a stored address that kept its casing.
    expect(mockUsersFindOneAndUpdate).toHaveBeenCalledWith(
      {
        _id: userId,
        emails: { $elemMatch: { address: 'user@example.com', verified: { $ne: true } } },
      },
      { $set: { 'emails.$.verified': true, authMethods: {} } },
      { collation: { locale: 'en', strength: 2 }, returnDocument: 'after' }
    );
  });

  test('signs out every session after a claim and returns the updated doc', async () => {
    const userId = new ObjectId();
    const claimedDoc = { _id: userId, authMethods: {} };
    mockUsersFindOneAndUpdate.mockResolvedValue(claimedDoc as never);

    const result = await claimUnverifiedEmail(userId, 'user@example.com');

    expect(result).toBe(claimedDoc);
    expect(mockInvalidateAllUserSessions).toHaveBeenCalledWith(userId);
    expect(mockInvalidateAllUserSessions.mock.invocationCallOrder[0]).toBeGreaterThan(
      mockUsersFindOneAndUpdate.mock.invocationCallOrder[0]
    );
  });

  test('changes nothing when the address is already verified or gone', async () => {
    mockUsersFindOneAndUpdate.mockResolvedValue(null);

    const result = await claimUnverifiedEmail(new ObjectId(), 'user@example.com');

    expect(result).toBeNull();
    expect(mockInvalidateAllUserSessions).not.toHaveBeenCalled();
  });
});
