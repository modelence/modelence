import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import type { Request, Response } from 'express';
import { ObjectId } from 'mongodb';

const mockUsersFindOne = jest.fn();
const mockUsersInsertOne = jest.fn();
const mockUsersUpdateOne = jest.fn();
const mockCreateSession = jest.fn();
const mockGetAuthConfig = jest.fn();
const mockGetCallContext = jest.fn();
const mockGetConfig = jest.fn();
const mockResolveUniqueHandle = jest.fn();

jest.unstable_mockModule('../db', () => ({
  usersCollection: {
    findOne: mockUsersFindOne,
    insertOne: mockUsersInsertOne,
    updateOne: mockUsersUpdateOne,
  },
}));

jest.unstable_mockModule('../session', () => ({
  createSession: mockCreateSession,
}));

jest.unstable_mockModule('@/app/authConfig', () => ({
  getAuthConfig: mockGetAuthConfig,
}));

jest.unstable_mockModule('@/app/server', () => ({
  getCallContext: mockGetCallContext,
}));

jest.unstable_mockModule('@/config/server', () => ({
  getConfig: mockGetConfig,
}));

jest.unstable_mockModule('../utils', () => ({
  resolveUniqueHandle: mockResolveUniqueHandle,
}));

const moduleExports = await import('./oauth-common');

describe('auth/providers/oauth-common', () => {
  const res = {
    cookie: jest.fn(),
    status: jest.fn().mockReturnThis(),
    redirect: jest.fn(),
    json: jest.fn(),
  } as unknown as Response;

  const req = {} as Request;

  const authConfig = {
    login: {
      onSuccess: jest.fn(),
      onError: jest.fn(),
    },
    onAfterLogin: jest.fn(),
    onLoginError: jest.fn(),
    signup: {
      onSuccess: jest.fn(),
      onError: jest.fn(),
    },
    onAfterSignup: jest.fn(),
    onSignupError: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockUsersFindOne.mockReset();
    mockUsersInsertOne.mockReset();
    mockUsersUpdateOne.mockReset();
    mockCreateSession.mockReset();
    mockGetAuthConfig.mockReset();
    mockGetCallContext.mockReset();
    mockGetConfig.mockReset();

    mockCreateSession.mockResolvedValue({ authToken: 'tok' } as never);
    mockGetAuthConfig.mockReturnValue(authConfig);
    mockGetCallContext.mockResolvedValue({
      session: { authToken: 'token' },
      connectionInfo: { ip: '1.1.1.1' },
    } as never);
    mockGetConfig.mockReturnValue('https://app.example.com');
    mockCreateSession.mockResolvedValue({ authToken: 'tok' } as never);
    mockResolveUniqueHandle.mockImplementation(
      async (_raw: unknown, email: unknown) => (email as string).split('@')[0]
    );
  });

  describe('authenticateUser', () => {
    test('creates session and sets cookie', async () => {
      mockCreateSession.mockResolvedValue({ authToken: 'tok' } as never);
      const userId = new ObjectId();

      await moduleExports.authenticateUser(res, userId);

      expect(mockCreateSession).toHaveBeenCalledWith(userId);
      expect(res.cookie).toHaveBeenCalledWith(
        'authToken',
        'tok',
        expect.objectContaining({
          httpOnly: true,
          sameSite: 'lax',
        })
      );
      expect(res.status).toHaveBeenCalledWith(302);
      expect(res.redirect).toHaveBeenCalledWith('/');
    });
  });

  describe('getRedirectUri', () => {
    test('builds redirect URI from config', () => {
      mockGetConfig.mockReturnValue('https://app.example.com');

      const uri = moduleExports.getRedirectUri('google');

      expect(uri).toBe('https://app.example.com/api/_internal/auth/google/callback');
    });
  });

  describe('validateOAuthCode', () => {
    test.each([
      { code: null, expected: null },
      { code: 123, expected: null },
      { code: 'abc', expected: 'abc' },
    ])('returns $expected for $code', ({ code, expected }) => {
      expect(moduleExports.validateOAuthCode(code as never)).toBe(expected);
    });
  });

  describe('handleOAuthUserAuthentication', () => {
    describe('Flow: Existing Provider Account', () => {
      test('logs in existing user via provider id without backfill when fields exist', async () => {
        const existingUser = {
          _id: new ObjectId(),
          handle: 'demo',
          status: 'active',
          firstName: 'Existing',
          lastName: 'User',
          avatarUrl: 'https://existing-pic.com',
        };
        mockUsersFindOne.mockResolvedValueOnce(existingUser as never);
        const userData = {
          id: 'provider-id',
          email: 'user@example.com',
          emailVerified: true,
          providerName: 'google' as const,
          firstName: 'New',
          lastName: 'Name',
          avatarUrl: 'https://new-pic.com',
        };

        await moduleExports.handleOAuthUserAuthentication(req, res, userData);

        expect(mockUsersFindOne).toHaveBeenCalledWith({
          'authMethods.google.id': 'provider-id',
        });
        expect(mockUsersUpdateOne).not.toHaveBeenCalled();
        expect(authConfig.onAfterLogin).toHaveBeenCalledWith(
          expect.objectContaining({ user: existingUser })
        );
        expect(authConfig.login.onSuccess).toHaveBeenCalledWith(existingUser);
      });

      test('backfills all missing profile fields for existing user', async () => {
        const existingUser = { _id: new ObjectId(), handle: 'demo', status: 'active' };
        mockUsersFindOne.mockResolvedValueOnce(existingUser as never);
        mockUsersUpdateOne.mockResolvedValueOnce({} as never);
        const userData = {
          id: 'provider-id',
          email: 'user@example.com',
          emailVerified: true,
          providerName: 'google' as const,
          firstName: 'John',
          lastName: 'Doe',
          avatarUrl: 'https://pic.com',
        };

        await moduleExports.handleOAuthUserAuthentication(req, res, userData);

        expect(mockUsersUpdateOne).toHaveBeenCalledWith(
          { _id: existingUser._id },
          { $set: { firstName: 'John', lastName: 'Doe', avatarUrl: 'https://pic.com' } }
        );

        const mergedUser = {
          ...existingUser,
          firstName: 'John',
          lastName: 'Doe',
          avatarUrl: 'https://pic.com',
        };
        expect(authConfig.onAfterLogin).toHaveBeenCalledWith(
          expect.objectContaining({ user: mergedUser })
        );
        expect(authConfig.login.onSuccess).toHaveBeenCalledWith(mergedUser);
      });

      test('backfills only missing profile fields, skips already-present ones', async () => {
        const existingUser = {
          _id: new ObjectId(),
          handle: 'demo',
          status: 'active',
          firstName: 'Already',
        };
        mockUsersFindOne.mockResolvedValueOnce(existingUser as never);
        mockUsersUpdateOne.mockResolvedValueOnce({} as never);
        const userData = {
          id: 'provider-id',
          email: 'user@example.com',
          emailVerified: true,
          providerName: 'github' as const,
          firstName: 'Ignored',
          lastName: 'Doe',
          avatarUrl: 'https://pic.com',
        };

        await moduleExports.handleOAuthUserAuthentication(req, res, userData);

        expect(mockUsersUpdateOne).toHaveBeenCalledWith(
          { _id: existingUser._id },
          { $set: { lastName: 'Doe', avatarUrl: 'https://pic.com' } }
        );

        const mergedUser = { ...existingUser, lastName: 'Doe', avatarUrl: 'https://pic.com' };
        expect(authConfig.onAfterLogin).toHaveBeenCalledWith(
          expect.objectContaining({ user: mergedUser })
        );
        expect(authConfig.login.onSuccess).toHaveBeenCalledWith(mergedUser);
      });

      test('rejects login for existing linked user if account is disabled', async () => {
        const disabledUser = { _id: new ObjectId(), handle: 'demo', status: 'disabled' };
        mockUsersFindOne.mockResolvedValueOnce(disabledUser as never);
        const userData = {
          id: 'provider-id',
          email: 'user@example.com',
          emailVerified: true,
          providerName: 'google' as const,
        };

        await moduleExports.handleOAuthUserAuthentication(req, res, userData);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({
          error: 'User account is not active.',
        });
        expect(mockCreateSession).not.toHaveBeenCalled();
      });

      test('rejects login for existing linked user if account is deleted', async () => {
        const deletedUser = { _id: new ObjectId(), handle: 'demo', status: 'deleted' };
        mockUsersFindOne.mockResolvedValueOnce(deletedUser as never);
        const userData = {
          id: 'provider-id',
          email: 'user@example.com',
          emailVerified: true,
          providerName: 'google' as const,
        };

        await moduleExports.handleOAuthUserAuthentication(req, res, userData);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({
          error: 'User account is not active.',
        });
        expect(mockCreateSession).not.toHaveBeenCalled();
      });
    });

    describe('Flow: Missing Data Validation', () => {
      test('returns error when provider does not supply email', async () => {
        mockUsersFindOne.mockResolvedValueOnce(null as never);

        await moduleExports.handleOAuthUserAuthentication(req, res, {
          id: 'provider-id',
          email: '' as never,
          emailVerified: false,
          providerName: 'google',
        });

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({
          error: 'Email address is required for google authentication.',
        });
      });

      test('email lookup errors trigger signup error callbacks', async () => {
        const lookupError = new Error('email lookup failed');
        mockUsersFindOne
          .mockResolvedValueOnce(null as never)
          .mockRejectedValueOnce(lookupError as never);

        await expect(
          moduleExports.handleOAuthUserAuthentication(req, res, {
            id: 'provider-id',
            email: 'user@example.com',
            emailVerified: true,
            providerName: 'google',
          })
        ).rejects.toThrow('email lookup failed');

        expect(authConfig.onSignupError).toHaveBeenCalledWith(
          expect.objectContaining({ error: lookupError, provider: 'google' })
        );
        expect(authConfig.signup.onError).toHaveBeenCalledWith(lookupError);
        expect(authConfig.onLoginError).not.toHaveBeenCalled();
        expect(authConfig.login.onError).not.toHaveBeenCalled();
        expect(mockUsersInsertOne).not.toHaveBeenCalled();
      });
    });

    describe('Flow: Existing Email Account / Auto-linking', () => {
      test('prevents signup when email already exists (default manual mode)', async () => {
        mockUsersFindOne.mockResolvedValueOnce(null as never).mockResolvedValueOnce({
          _id: new ObjectId(),
          status: 'active',
        } as never);

        await moduleExports.handleOAuthUserAuthentication(req, res, {
          id: 'provider-id',
          email: 'user@example.com',
          emailVerified: true,
          providerName: 'github',
        });

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({
          error: 'User with this email already exists. Please log in instead.',
        });
        expect(mockUsersUpdateOne).not.toHaveBeenCalled();
      });

      test('rejects OAuth for disabled user accounts in default manual mode', async () => {
        mockUsersFindOne.mockResolvedValueOnce(null as never).mockResolvedValueOnce({
          _id: new ObjectId(),
          status: 'disabled',
        } as never);

        await moduleExports.handleOAuthUserAuthentication(req, res, {
          id: 'google-id',
          email: 'user@example.com',
          emailVerified: true,
          providerName: 'google',
        });

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({
          error: 'User with this email already exists. Please log in instead.',
        });
        expect(mockUsersUpdateOne).not.toHaveBeenCalled();
        expect(mockCreateSession).not.toHaveBeenCalled();
      });

      test('rejects auto-link for disabled user accounts', async () => {
        mockUsersFindOne.mockResolvedValueOnce(null as never).mockResolvedValueOnce({
          _id: new ObjectId(),
          status: 'disabled',
          emails: [{ address: 'user@example.com', verified: true }],
        } as never);

        mockGetAuthConfig.mockReturnValue({
          ...authConfig,
          oauthAccountLinking: 'auto',
        });

        await moduleExports.handleOAuthUserAuthentication(req, res, {
          id: 'google-id',
          email: 'user@example.com',
          emailVerified: true,
          providerName: 'google',
        });

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({
          error: 'User account is not active.',
        });
        expect(mockUsersUpdateOne).not.toHaveBeenCalled();
        expect(mockCreateSession).not.toHaveBeenCalled();
      });

      test('auto-links OAuth provider when oauthAccountLinking is auto and email is verified', async () => {
        const existingUser = {
          _id: new ObjectId(),
          handle: 'user@example.com',
          status: 'active',
          emails: [{ address: 'user@example.com', verified: true }],
        };
        const updatedUser = { ...existingUser, authMethods: { google: { id: 'google-id' } } };
        mockUsersFindOne
          .mockResolvedValueOnce(null as never)
          .mockResolvedValueOnce(existingUser as never);
        mockUsersUpdateOne.mockResolvedValue({ matchedCount: 1 } as never);
        mockCreateSession.mockResolvedValue({ authToken: 'tok' } as never);

        mockGetAuthConfig.mockReturnValue({
          ...authConfig,
          oauthAccountLinking: 'auto',
        });

        await moduleExports.handleOAuthUserAuthentication(req, res, {
          id: 'google-id',
          email: 'user@example.com',
          emailVerified: true,
          providerName: 'google',
        });

        expect(mockUsersUpdateOne).toHaveBeenCalledWith(
          {
            _id: existingUser._id,
            status: { $nin: ['deleted', 'disabled'] },
            $or: [
              { 'authMethods.google.id': { $exists: false } },
              { 'authMethods.google.id': 'google-id' },
            ],
          },
          { $set: { 'authMethods.google.id': 'google-id' } }
        );
        expect(mockCreateSession).toHaveBeenCalledWith(existingUser._id);
        expect(authConfig.onAfterLogin).toHaveBeenCalledWith(
          expect.objectContaining({ user: updatedUser, provider: 'google' })
        );
        expect(authConfig.login.onSuccess).toHaveBeenCalledWith(updatedUser);
      });

      test('backfills missing profile fields for existing user auto-linking', async () => {
        const existingUser = {
          _id: new ObjectId(),
          handle: 'user@example.com',
          status: 'active',
          emails: [{ address: 'user@example.com', verified: true }],
        };
        const updatedUser = {
          ...existingUser,
          firstName: 'New',
          lastName: 'User',
          avatarUrl: 'pic-url',
          authMethods: { google: { id: 'google-id' } },
        };
        mockUsersFindOne
          .mockResolvedValueOnce(null as never)
          .mockResolvedValueOnce(existingUser as never);
        mockUsersUpdateOne.mockResolvedValue({ matchedCount: 1 } as never);
        mockCreateSession.mockResolvedValue({ authToken: 'tok' } as never);

        mockGetAuthConfig.mockReturnValue({
          ...authConfig,
          oauthAccountLinking: 'auto',
        });

        await moduleExports.handleOAuthUserAuthentication(req, res, {
          id: 'google-id',
          email: 'user@example.com',
          emailVerified: true,
          providerName: 'google',
          firstName: 'New',
          lastName: 'User',
          avatarUrl: 'pic-url',
        });

        expect(mockUsersUpdateOne).toHaveBeenCalledWith(expect.anything(), {
          $set: {
            'authMethods.google.id': 'google-id',
            firstName: 'New',
            lastName: 'User',
            avatarUrl: 'pic-url',
          },
        });
        expect(authConfig.onAfterLogin).toHaveBeenCalledWith(
          expect.objectContaining({ user: updatedUser, provider: 'google' })
        );
      });

      test('proceeds to login if concurrent request already linked the same provider ID', async () => {
        const existingUser = {
          _id: new ObjectId(),
          handle: 'user@example.com',
          status: 'active',
          emails: [{ address: 'user@example.com', verified: true }],
        };
        const updatedUser = { ...existingUser, authMethods: { google: { id: 'google-id' } } };
        mockUsersFindOne
          .mockResolvedValueOnce(null as never) // provider ID lookup
          .mockResolvedValueOnce(existingUser as never); // email lookup
        mockUsersUpdateOne.mockResolvedValue({ matchedCount: 1 } as never); // update succeeds via $or
        mockCreateSession.mockResolvedValue({ authToken: 'tok' } as never);

        mockGetAuthConfig.mockReturnValue({
          ...authConfig,
          oauthAccountLinking: 'auto',
        });

        await moduleExports.handleOAuthUserAuthentication(req, res, {
          id: 'google-id',
          email: 'user@example.com',
          emailVerified: true,
          providerName: 'google',
        });

        expect(mockUsersUpdateOne).toHaveBeenCalled();
        expect(mockCreateSession).toHaveBeenCalledWith(existingUser._id);
        expect(authConfig.onAfterLogin).toHaveBeenCalledWith(
          expect.objectContaining({ user: updatedUser, provider: 'google' })
        );
        expect(authConfig.login.onSuccess).toHaveBeenCalledWith(updatedUser);
      });

      test('rejects auto-link if update fails completely (e.g., user deleted/disabled or different provider ID linked concurrently)', async () => {
        const existingUser = {
          _id: new ObjectId(),
          handle: 'user@example.com',
          status: 'active',
          emails: [{ address: 'user@example.com', verified: true }],
        };
        mockUsersFindOne
          .mockResolvedValueOnce(null as never) // provider ID lookup
          .mockResolvedValueOnce(existingUser as never); // email lookup

        mockUsersUpdateOne.mockResolvedValue({ matchedCount: 0 } as never);

        mockGetAuthConfig.mockReturnValue({
          ...authConfig,
          oauthAccountLinking: 'auto',
        });

        await moduleExports.handleOAuthUserAuthentication(req, res, {
          id: 'google-id',
          email: 'user@example.com',
          emailVerified: true,
          providerName: 'google',
        });

        expect(mockUsersUpdateOne).toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({
          error: 'User with this email already exists. Please log in instead.',
        });
        expect(mockCreateSession).not.toHaveBeenCalled();
      });

      test('rejects auto-link when oauthAccountLinking is auto but email is NOT verified', async () => {
        const existingUser = {
          _id: new ObjectId(),
          handle: 'user@example.com',
          status: 'active',
          emails: [{ address: 'user@example.com', verified: true }],
        };
        mockUsersFindOne
          .mockResolvedValueOnce(null as never)
          .mockResolvedValueOnce(existingUser as never);

        mockGetAuthConfig.mockReturnValue({
          ...authConfig,
          oauthAccountLinking: 'auto',
        });

        await moduleExports.handleOAuthUserAuthentication(req, res, {
          id: 'google-id',
          email: 'user@example.com',
          emailVerified: false,
          providerName: 'google',
        });

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({
          error: 'User with this email already exists. Please log in instead.',
        });
        expect(mockUsersUpdateOne).not.toHaveBeenCalled();
        expect(mockCreateSession).not.toHaveBeenCalled();
      });

      test('rejects auto-link when provider email is verified but local email is unverified', async () => {
        const existingUser = {
          _id: new ObjectId(),
          handle: 'user@example.com',
          status: 'active',
          emails: [{ address: 'user@example.com', verified: false }],
        };
        mockUsersFindOne
          .mockResolvedValueOnce(null as never) // provider ID lookup
          .mockResolvedValueOnce(existingUser as never); // email lookup

        mockGetAuthConfig.mockReturnValue({
          ...authConfig,
          oauthAccountLinking: 'auto',
        });

        await moduleExports.handleOAuthUserAuthentication(req, res, {
          id: 'google-id',
          email: 'user@example.com',
          emailVerified: true,
          providerName: 'google',
        });

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({
          error: 'User with this email already exists. Please log in instead.',
        });
        expect(mockUsersUpdateOne).not.toHaveBeenCalled();
        expect(mockCreateSession).not.toHaveBeenCalled();
      });

      test('auto-link errors trigger login error callbacks, not signup', async () => {
        const existingUser = {
          _id: new ObjectId(),
          handle: 'user@example.com',
          status: 'active',
          emails: [{ address: 'user@example.com', verified: true }],
        };
        mockUsersFindOne
          .mockResolvedValueOnce(null as never)
          .mockResolvedValueOnce(existingUser as never);
        const updateError = new Error('updateOne failed');
        mockUsersUpdateOne.mockRejectedValueOnce(updateError as never);

        mockGetAuthConfig.mockReturnValue({
          ...authConfig,
          oauthAccountLinking: 'auto',
        });

        await expect(
          moduleExports.handleOAuthUserAuthentication(req, res, {
            id: 'google-id',
            email: 'user@example.com',
            emailVerified: true,
            providerName: 'google',
          })
        ).rejects.toThrow('updateOne failed');

        // Should trigger login error callbacks
        expect(authConfig.login.onError).toHaveBeenCalledWith(updateError);
        expect(authConfig.onLoginError).toHaveBeenCalledWith(
          expect.objectContaining({ error: updateError, provider: 'google' })
        );

        // Should NOT trigger signup error callbacks
        expect(authConfig.signup.onError).not.toHaveBeenCalled();
        expect(authConfig.onSignupError).not.toHaveBeenCalled();
      });
    });

    describe('Flow: Brand New User', () => {
      test('creates new user when no existing records found', async () => {
        mockUsersFindOne.mockResolvedValueOnce(null as never).mockResolvedValueOnce(null as never);
        const insertedId = new ObjectId();
        mockUsersInsertOne.mockResolvedValue({ insertedId } as never);
        const userDocument = { _id: insertedId, handle: 'user' };
        mockUsersFindOne.mockResolvedValueOnce(userDocument as never);

        await moduleExports.handleOAuthUserAuthentication(req, res, {
          id: 'provider-id',
          email: 'user@example.com',
          emailVerified: true,
          providerName: 'google',
          firstName: 'New',
          lastName: 'User',
          avatarUrl: 'pic-url',
        });

        expect(mockResolveUniqueHandle).toHaveBeenCalledWith(undefined, 'user@example.com');
        expect(mockUsersInsertOne).toHaveBeenCalledWith(
          expect.objectContaining({
            handle: 'user',
            authMethods: {
              google: { id: 'provider-id' },
            },
            firstName: 'New',
            lastName: 'User',
            avatarUrl: 'pic-url',
          })
        );
        expect(authConfig.onAfterSignup).toHaveBeenCalledWith(
          expect.objectContaining({ user: userDocument })
        );
        expect(authConfig.signup.onSuccess).toHaveBeenCalledWith(userDocument);
      });
    });
  });

  describe('handleOAuthProviderLink', () => {
    const linkAuthConfig = {
      ...authConfig,
      onAfterOAuthLink: jest.fn(),
      onOAuthLinkError: jest.fn(),
    };

    const userData = {
      id: 'google-provider-id',
      email: 'user@example.com',
      emailVerified: true,
      providerName: 'google' as const,
      firstName: 'John',
      lastName: 'Doe',
      avatarUrl: 'https://pic.com',
    };

    test('returns 401 when user is not signed in (no session userId)', async () => {
      mockGetCallContext.mockResolvedValue({
        session: { authToken: 'token', userId: null },
        connectionInfo: { ip: '1.1.1.1' },
      } as never);
      mockGetAuthConfig.mockReturnValue(linkAuthConfig);

      await moduleExports.handleOAuthProviderLink(req, res, userData);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: 'You must be signed in to link a provider.',
      });
      expect(mockUsersUpdateOne).not.toHaveBeenCalled();
    });

    test('returns 400 when provider is already linked to a different user', async () => {
      const currentUserId = new ObjectId();

      mockGetCallContext.mockResolvedValue({
        session: { authToken: 'token', userId: currentUserId },
        connectionInfo: { ip: '1.1.1.1' },
      } as never);
      mockGetAuthConfig.mockReturnValue(linkAuthConfig);

      const err = new Error('E11000 duplicate key error');
      (err as any).code = 11000;
      mockUsersUpdateOne.mockRejectedValueOnce(err as never);

      await moduleExports.handleOAuthProviderLink(req, res, userData);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'This google account is already linked to a different user.',
      });
      expect(linkAuthConfig.onOAuthLinkError).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'google',
          error: err,
        })
      );
    });

    test('returns 400 when user account is not active (update matches 0)', async () => {
      const currentUserId = new ObjectId();

      mockGetCallContext.mockResolvedValue({
        session: { authToken: 'token', userId: currentUserId },
        connectionInfo: { ip: '1.1.1.1' },
      } as never);
      mockGetAuthConfig.mockReturnValue(linkAuthConfig);

      // updateOne returns 0 matches
      mockUsersUpdateOne.mockResolvedValueOnce({ matchedCount: 0 } as never);
      // findOne returns disabled user
      mockUsersFindOne.mockResolvedValueOnce({
        _id: currentUserId,
        status: 'disabled',
      } as never);

      await moduleExports.handleOAuthProviderLink(req, res, userData);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'User account is not active.',
      });
      expect(linkAuthConfig.onOAuthLinkError).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'google',
          error: expect.objectContaining({ message: 'User account not found or not active' }),
        })
      );
    });

    test('returns 400 when user already has a different provider ID linked', async () => {
      const currentUserId = new ObjectId();

      mockGetCallContext.mockResolvedValue({
        session: { authToken: 'token', userId: currentUserId },
        connectionInfo: { ip: '1.1.1.1' },
      } as never);
      mockGetAuthConfig.mockReturnValue(linkAuthConfig);

      // updateOne returns 0 matches (because user already has a different ID for this provider)
      mockUsersUpdateOne.mockResolvedValueOnce({ matchedCount: 0 } as never);
      // findOne returns an active user
      mockUsersFindOne.mockResolvedValueOnce({
        _id: currentUserId,
        status: 'active',
        authMethods: {
          google: { id: 'different-google-id' },
        },
      } as never);

      await moduleExports.handleOAuthProviderLink(req, res, userData);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: `You have already linked a different google account.`,
      });
      expect(linkAuthConfig.onOAuthLinkError).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'google',
          error: expect.objectContaining({
            message: `User already has a different google account linked`,
          }),
        })
      );
    });

    test('returns fallback error when update matches 0 but provider state is unexpected', async () => {
      const currentUserId = new ObjectId();

      mockGetCallContext.mockResolvedValue({
        session: { authToken: 'token', userId: currentUserId },
        connectionInfo: { ip: '1.1.1.1' },
      } as never);

      mockGetAuthConfig.mockReturnValue(linkAuthConfig);

      // updateOne fails to match
      mockUsersUpdateOne.mockResolvedValueOnce({ matchedCount: 0 } as never);

      // user exists but provider field is malformed / unexpected
      mockUsersFindOne.mockResolvedValueOnce({
        _id: currentUserId,
        status: 'active',
        authMethods: {
          google: {}, // no id present → triggers fallback
        },
      } as never);

      await moduleExports.handleOAuthProviderLink(req, res, userData);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Unable to link google account.',
      });

      expect(linkAuthConfig.onOAuthLinkError).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'google',
          error: expect.objectContaining({
            message: 'Unexpected OAuth linking state for google',
          }),
        })
      );
    });

    test('successfully links provider and calls onAfterOAuthLink hook', async () => {
      const currentUserId = new ObjectId();
      const updatedUser = {
        _id: currentUserId,
        handle: 'demo',
        status: 'active',
        authMethods: { google: { id: 'google-provider-id' } },
      };

      mockGetCallContext.mockResolvedValue({
        session: { authToken: 'token', userId: currentUserId },
        connectionInfo: { ip: '1.1.1.1' },
      } as never);
      mockGetAuthConfig.mockReturnValue(linkAuthConfig);

      // No initial findOne needed — the new code does updateOne first with $or guard
      // Update succeeds
      mockUsersUpdateOne.mockResolvedValueOnce({ matchedCount: 1 } as never);
      // Fetch updated user
      mockUsersFindOne.mockResolvedValueOnce(updatedUser as never);

      await moduleExports.handleOAuthProviderLink(req, res, userData);

      expect(mockUsersUpdateOne).toHaveBeenCalledWith(
        {
          _id: currentUserId,
          status: { $nin: ['deleted', 'disabled'] },
          $or: [
            { 'authMethods.google.id': { $exists: false } },
            { 'authMethods.google.id': 'google-provider-id' },
          ],
        },
        {
          $set: { 'authMethods.google.id': 'google-provider-id' },
        }
      );
      expect(linkAuthConfig.onAfterOAuthLink).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'google',
          user: updatedUser,
        })
      );
      expect(res.status).toHaveBeenCalledWith(302);
      expect(res.redirect).toHaveBeenCalledWith('/');
    });

    test('allows linking when provider is already linked to the SAME user', async () => {
      const currentUserId = new ObjectId();

      mockGetCallContext.mockResolvedValue({
        session: { authToken: 'token', userId: currentUserId },
        connectionInfo: { ip: '1.1.1.1' },
      } as never);
      mockGetAuthConfig.mockReturnValue(linkAuthConfig);

      // Provider already linked to THIS user — updateOne still matches
      // because the $or condition allows the same provider ID
      mockUsersUpdateOne.mockResolvedValueOnce({ matchedCount: 1 } as never);
      mockUsersFindOne.mockResolvedValueOnce({
        _id: currentUserId,
        handle: 'demo',
        authMethods: { google: { id: 'google-provider-id' } },
      } as never);

      await moduleExports.handleOAuthProviderLink(req, res, userData);

      // Should still proceed and update (idempotent)
      expect(mockUsersUpdateOne).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(302);
    });

    test('does not crash if onOAuthLinkError throws', async () => {
      linkAuthConfig.onOAuthLinkError.mockImplementation(() => {
        throw new Error('hook failed');
      });

      const currentUserId = new ObjectId();

      mockGetCallContext.mockResolvedValue({
        session: { userId: currentUserId },
        connectionInfo: {},
      } as never);

      mockUsersUpdateOne.mockResolvedValueOnce({ matchedCount: 0 } as never);
      mockUsersFindOne.mockResolvedValueOnce(null as never);

      await moduleExports.handleOAuthProviderLink(req, res, userData);

      expect(res.status).toHaveBeenCalled(); // still works
    });

    test('calls onOAuthLinkError when an unexpected error occurs', async () => {
      const currentUserId = new ObjectId();
      const dbError = new Error('database connection lost');

      mockGetCallContext.mockResolvedValue({
        session: { authToken: 'token', userId: currentUserId },
        connectionInfo: { ip: '1.1.1.1' },
      } as never);
      mockGetAuthConfig.mockReturnValue(linkAuthConfig);

      // No initial findOne needed — updateOne with $or guard is first
      // Update throws
      mockUsersUpdateOne.mockRejectedValueOnce(dbError as never);

      await expect(moduleExports.handleOAuthProviderLink(req, res, userData)).rejects.toThrow(
        'database connection lost'
      );

      expect(linkAuthConfig.onOAuthLinkError).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'google',
          error: dbError,
        })
      );
    });
  });
});
