import { beforeEach, describe, expect, test, vi } from 'vitest';
import { ObjectId } from 'mongodb';

const mockUsersUpdateOne = vi.fn();
const mockEmailDeleteMany = vi.fn();
const mockResetDeleteMany = vi.fn();
const mockRandomUUID = vi.fn(() => 'uuid-123');

vi.doMock('./db', () => ({
  usersCollection: {
    updateOne: mockUsersUpdateOne,
  },
  emailVerificationTokensCollection: {
    deleteMany: mockEmailDeleteMany,
  },
  resetPasswordTokensCollection: {
    deleteMany: mockResetDeleteMany,
  },
}));

vi.doMock('crypto', () => ({
  randomUUID: mockRandomUUID,
}));

const { clearTokens, disableUser, deleteUser } = await import('./deleteUser');

describe('auth/deleteUser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('clearTokens removes verification and reset tokens for user', async () => {
    const userId = new ObjectId('507f1f77bcf86cd799439011');

    await clearTokens(userId);

    expect(mockEmailDeleteMany).toHaveBeenCalledWith({ userId });
    expect(mockResetDeleteMany).toHaveBeenCalledWith({ userId });
  });

  test('disableUser clears tokens and disables user record', async () => {
    const userId = new ObjectId('507f1f77bcf86cd799439012');

    await disableUser(userId);

    expect(mockEmailDeleteMany).toHaveBeenCalledWith({ userId });
    expect(mockResetDeleteMany).toHaveBeenCalledWith({ userId });
    expect(mockUsersUpdateOne).toHaveBeenCalledWith(userId, {
      $set: {
        status: 'disabled',
        disabledAt: expect.any(Date),
      },
    });
  });

  test('deleteUser clears tokens and anonymizes user profile', async () => {
    const userId = new ObjectId('507f1f77bcf86cd799439013');

    await deleteUser(userId);

    expect(mockEmailDeleteMany).toHaveBeenCalledWith({ userId });
    expect(mockResetDeleteMany).toHaveBeenCalledWith({ userId });
    expect(mockRandomUUID).toHaveBeenCalledTimes(1);
    expect(mockUsersUpdateOne).toHaveBeenCalledWith(
      {
        _id: userId,
      },
      {
        $set: {
          handle: `deleted-${userId}-uuid-123`,
          status: 'deleted',
          deletedAt: expect.any(Date),
          authMethods: {},
          emails: [],
        },
      }
    );
  });
});
