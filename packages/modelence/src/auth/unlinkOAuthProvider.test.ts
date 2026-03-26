import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { ObjectId } from 'mongodb';
import { SUPPORTED_OAUTH_PROVIDERS } from './types';

const mockRequireById = jest.fn();
const mockUpdateOne = jest.fn();

jest.unstable_mockModule('./db', () => ({
  usersCollection: {
    requireById: mockRequireById,
    updateOne: mockUpdateOne,
  },
}));

const { handleUnlinkOAuthProvider } = await import('./unlinkOAuthProvider');

describe('auth/unlinkOAuthProvider', () => {
  const userId = new ObjectId();

  const mockContext = {
    user: {
      id: userId.toString(),
      handle: 'demo',
      roles: [] as string[],
      hasRole: (_role: string) => false,
      requireRole: (_role: string) => {},
    },
    session: null,
    roles: [],
    clientInfo: {
      screenWidth: 1920,
      screenHeight: 1080,
      windowWidth: 1920,
      windowHeight: 1080,
      pixelRatio: 1,
      orientation: null,
    },
    connectionInfo: { ip: '1.1.1.1' },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockRequireById.mockReset();
    mockUpdateOne.mockReset();
  });

  test('throws error when user is not signed in', async () => {
    await expect(
      handleUnlinkOAuthProvider({ provider: 'google' }, { ...mockContext, user: null })
    ).rejects.toThrow('You must be signed in to unlink a provider.');

    expect(mockRequireById).not.toHaveBeenCalled();
  });

  test('throws error when provider argument is not a valid OAuth provider', async () => {
    await expect(handleUnlinkOAuthProvider({ provider: 123 }, mockContext)).rejects.toThrow(
      `Invalid provider. Supported providers are: ${SUPPORTED_OAUTH_PROVIDERS.join(', ')}.`
    );

    expect(mockRequireById).not.toHaveBeenCalled();
  });

  test('throws error when user is not found', async () => {
    mockRequireById.mockRejectedValueOnce(new Error('User not found.') as never);

    await expect(handleUnlinkOAuthProvider({ provider: 'google' }, mockContext)).rejects.toThrow(
      'User not found.'
    );
  });

  test('throws error when provider is not linked to account', async () => {
    mockRequireById.mockResolvedValueOnce({
      _id: userId,
      authMethods: {
        password: { hash: 'hashed-password' },
      },
    } as never);

    await expect(handleUnlinkOAuthProvider({ provider: 'google' }, mockContext)).rejects.toThrow(
      'google is not linked to your account.'
    );

    expect(mockUpdateOne).not.toHaveBeenCalled();
  });

  test('throws error when trying to unlink the only auth method (lockout prevention)', async () => {
    mockRequireById.mockResolvedValueOnce({
      _id: userId,
      authMethods: {
        google: { id: 'google-id-123' },
      },
    } as never);

    await expect(handleUnlinkOAuthProvider({ provider: 'google' }, mockContext)).rejects.toThrow(
      'Cannot unlink your only authentication method. Please add another method first.'
    );

    expect(mockUpdateOne).not.toHaveBeenCalled();
  });

  test('throws when atomic guard prevents unlink due to concurrent removal', async () => {
    mockRequireById.mockResolvedValueOnce({
      _id: userId,
      authMethods: {
        google: { id: 'google-id' },
        github: { id: 'github-id' },
      },
    } as never);

    mockUpdateOne.mockResolvedValueOnce({ matchedCount: 0 } as never);

    await expect(handleUnlinkOAuthProvider({ provider: 'google' }, mockContext)).rejects.toThrow(
      'Cannot unlink your only authentication method. Please add another method first.'
    );
  });

  test('successfully unlinks provider when user has multiple auth methods', async () => {
    mockRequireById.mockResolvedValueOnce({
      _id: userId,
      authMethods: {
        password: { hash: 'hashed-password' },
        google: { id: 'google-id-123' },
      },
    } as never);
    mockUpdateOne.mockResolvedValueOnce({ matchedCount: 1 } as never);

    await handleUnlinkOAuthProvider({ provider: 'google' }, mockContext);

    expect(mockUpdateOne).toHaveBeenCalledWith(
      { _id: userId, $or: [{ 'authMethods.password': { $exists: true } }] },
      { $unset: { 'authMethods.google': '' } }
    );
  });

  test('successfully unlinks github when google and github are both linked', async () => {
    mockRequireById.mockResolvedValueOnce({
      _id: userId,
      authMethods: {
        google: { id: 'google-id' },
        github: { id: 'github-id' },
      },
    } as never);
    mockUpdateOne.mockResolvedValueOnce({ matchedCount: 1 } as never);

    await handleUnlinkOAuthProvider({ provider: 'github' }, mockContext);

    expect(mockUpdateOne).toHaveBeenCalledWith(
      { _id: userId, $or: [{ 'authMethods.google': { $exists: true } }] },
      { $unset: { 'authMethods.github': '' } }
    );
  });

  test('successfully unlinks google when user has password + google + github', async () => {
    mockRequireById.mockResolvedValueOnce({
      _id: userId,
      authMethods: {
        password: { hash: 'hashed-password' },
        google: { id: 'google-id' },
        github: { id: 'github-id' },
      },
    } as never);
    mockUpdateOne.mockResolvedValueOnce({ matchedCount: 1 } as never);

    await handleUnlinkOAuthProvider({ provider: 'google' }, mockContext);

    expect(mockUpdateOne).toHaveBeenCalledWith(
      {
        _id: userId,
        $or: [
          { 'authMethods.password': { $exists: true } },
          { 'authMethods.github': { $exists: true } },
        ],
      },
      { $unset: { 'authMethods.google': '' } }
    );
  });
});
