import { beforeEach, describe, expect, test, vi } from 'vitest';
import { ObjectId } from 'mongodb';

const mockUsersUpdateOne = vi.fn();
const mockUsersFindOne = vi.fn();
const mockEmailDeleteMany = vi.fn();
const mockResetDeleteMany = vi.fn();
const mockMagicLinkDeleteMany = vi.fn();
const mockRandomUUID = vi.fn(() => 'uuid-123');

vi.doMock('./db', () => ({
  usersCollection: {
    updateOne: mockUsersUpdateOne,
    findOne: mockUsersFindOne,
  },
  emailVerificationTokensCollection: {
    deleteMany: mockEmailDeleteMany,
  },
  resetPasswordTokensCollection: {
    deleteMany: mockResetDeleteMany,
  },
  magicLinkTokensCollection: {
    deleteMany: mockMagicLinkDeleteMany,
  },
}));

vi.doMock('crypto', () => ({
  randomUUID: mockRandomUUID,
}));

const { clearTokens, disableUser, deleteUser } = await import('./deleteUser');

describe('auth/deleteUser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: a user with a single mixed-case email so the magic-link revoke path
    // runs. Individual tests override this as needed.
    mockUsersFindOne.mockResolvedValue({
      _id: new ObjectId(),
      emails: [{ address: 'User@Example.com', verified: true }],
    });
  });

  test('clearTokens removes verification, reset, and magic link tokens for user', async () => {
    const userId = new ObjectId('507f1f77bcf86cd799439011');
    mockUsersFindOne.mockResolvedValue({
      _id: userId,
      emails: [
        { address: 'User@Example.com', verified: true },
        { address: 'ALT@Example.com', verified: true },
      ],
    });

    await clearTokens(userId);

    expect(mockEmailDeleteMany).toHaveBeenCalledWith({ userId });
    expect(mockResetDeleteMany).toHaveBeenCalledWith({ userId });
    // Magic link tokens are keyed by email; revoke every address, lowercased.
    expect(mockMagicLinkDeleteMany).toHaveBeenCalledWith({
      email: { $in: ['user@example.com', 'alt@example.com'] },
    });
  });

  test('clearTokens does not revoke magic link tokens when the user has no emails', async () => {
    const userId = new ObjectId('507f1f77bcf86cd799439011');
    mockUsersFindOne.mockResolvedValue({ _id: userId, emails: [] });

    await clearTokens(userId);

    expect(mockMagicLinkDeleteMany).not.toHaveBeenCalled();
  });

  test('clearTokens does not revoke magic link tokens when the user is missing', async () => {
    const userId = new ObjectId('507f1f77bcf86cd799439011');
    mockUsersFindOne.mockResolvedValue(null);

    await clearTokens(userId);

    expect(mockMagicLinkDeleteMany).not.toHaveBeenCalled();
  });

  test('disableUser clears tokens and disables user record', async () => {
    const userId = new ObjectId('507f1f77bcf86cd799439012');

    await disableUser(userId);

    expect(mockEmailDeleteMany).toHaveBeenCalledWith({ userId });
    expect(mockResetDeleteMany).toHaveBeenCalledWith({ userId });
    expect(mockMagicLinkDeleteMany).toHaveBeenCalledWith({
      email: { $in: ['user@example.com'] },
    });
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
    // Magic links must be revoked before the profile update wipes `emails`.
    expect(mockMagicLinkDeleteMany).toHaveBeenCalledWith({
      email: { $in: ['user@example.com'] },
    });
    expect(mockUsersFindOne.mock.invocationCallOrder[0]).toBeLessThan(
      mockUsersUpdateOne.mock.invocationCallOrder[0]
    );
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
