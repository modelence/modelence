import { beforeEach, describe, expect, test, vi } from 'vitest';
import { ObjectId } from 'mongodb';
import { SUPPORTED_OAUTH_PROVIDERS } from './types';
import { AuthError, ValidationError } from '../error';

const mockRequireById = vi.fn();
const mockUpdateOne = vi.fn();

vi.doMock('./db', () => ({
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
    req: null,
    res: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireById.mockReset();
    mockUpdateOne.mockReset();
  });

  test('throws AuthError when user is not signed in', async () => {
    const errorPromise = handleUnlinkOAuthProvider(
      { provider: 'google' },
      { ...mockContext, user: null }
    );

    await expect(errorPromise).rejects.toThrow(AuthError);
    await expect(errorPromise).rejects.toThrow('You must be signed in to unlink a provider.');
    await expect(errorPromise).rejects.toMatchObject({
      status: 401,
      code: 'UNAUTHENTICATED',
    });

    expect(mockRequireById).not.toHaveBeenCalled();
  });

  test('throws ValidationError when provider argument is not a valid OAuth provider', async () => {
    const errorPromise = handleUnlinkOAuthProvider({ provider: 123 }, mockContext);

    await expect(errorPromise).rejects.toThrow(ValidationError);
    await expect(errorPromise).rejects.toThrow(
      `Invalid provider. Supported providers are: ${SUPPORTED_OAUTH_PROVIDERS.join(', ')}.`
    );
    await expect(errorPromise).rejects.toMatchObject({
      status: 400,
      code: 'INVALID_PROVIDER',
    });

    expect(mockRequireById).not.toHaveBeenCalled();
  });

  test('throws error when user is not found', async () => {
    mockRequireById.mockRejectedValueOnce(new Error('User not found.') as never);

    await expect(handleUnlinkOAuthProvider({ provider: 'google' }, mockContext)).rejects.toThrow(
      'User not found.'
    );
  });

  test('throws ValidationError when provider is not linked to account', async () => {
    mockRequireById.mockResolvedValueOnce({
      _id: userId,
      authMethods: {
        password: { hash: 'hashed-password' },
      },
    } as never);

    const errorPromise = handleUnlinkOAuthProvider({ provider: 'google' }, mockContext);

    await expect(errorPromise).rejects.toThrow(ValidationError);
    await expect(errorPromise).rejects.toThrow('google is not linked to your account.');
    await expect(errorPromise).rejects.toMatchObject({
      status: 400,
      code: 'PROVIDER_NOT_LINKED',
    });

    expect(mockUpdateOne).not.toHaveBeenCalled();
  });

  test('throws ValidationError when trying to unlink the only auth method (lockout prevention)', async () => {
    mockRequireById.mockResolvedValueOnce({
      _id: userId,
      authMethods: {
        google: { id: 'google-id-123' },
      },
    } as never);

    const errorPromise = handleUnlinkOAuthProvider({ provider: 'google' }, mockContext);

    await expect(errorPromise).rejects.toThrow(ValidationError);
    await expect(errorPromise).rejects.toThrow(
      'Cannot unlink your only authentication method. Please add another method first.'
    );
    await expect(errorPromise).rejects.toMatchObject({
      status: 400,
      code: 'CANNOT_UNLINK_ONLY_METHOD',
    });

    expect(mockUpdateOne).not.toHaveBeenCalled();
  });

  test('throws ValidationError when atomic guard prevents unlink due to concurrent removal', async () => {
    mockRequireById.mockResolvedValueOnce({
      _id: userId,
      authMethods: {
        google: { id: 'google-id' },
        github: { id: 'github-id' },
      },
    } as never);

    mockUpdateOne.mockResolvedValueOnce({ matchedCount: 0 } as never);

    const errorPromise = handleUnlinkOAuthProvider({ provider: 'google' }, mockContext);

    await expect(errorPromise).rejects.toThrow(ValidationError);
    await expect(errorPromise).rejects.toThrow(
      'Cannot unlink your only authentication method. Please add another method first.'
    );
    await expect(errorPromise).rejects.toMatchObject({
      status: 400,
      code: 'CANNOT_UNLINK_ONLY_METHOD',
    });
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
