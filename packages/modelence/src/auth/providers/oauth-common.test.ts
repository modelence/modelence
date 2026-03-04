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
          sameSite: 'strict',
        })
      );
      expect(res.status).toHaveBeenCalledWith(301);
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
      test('logs in existing user via provider id', async () => {
        const existingUser = { _id: new ObjectId(), handle: 'demo', status: 'active' };
        mockUsersFindOne.mockResolvedValueOnce(existingUser as never);
        const userData = {
          id: 'provider-id',
          email: 'user@example.com',
          emailVerified: true,
          providerName: 'google' as const,
        };

        await moduleExports.handleOAuthUserAuthentication(req, res, userData);

        expect(mockUsersFindOne).toHaveBeenCalledWith({
          'authMethods.google.id': 'provider-id',
        });
        expect(authConfig.onAfterLogin).toHaveBeenCalledWith(
          expect.objectContaining({ user: existingUser })
        );
        expect(authConfig.login.onSuccess).toHaveBeenCalledWith(existingUser);
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
        const userDocument = { _id: insertedId, handle: 'user@example.com' };
        mockUsersFindOne.mockResolvedValueOnce(userDocument as never);

        await moduleExports.handleOAuthUserAuthentication(req, res, {
          id: 'provider-id',
          email: 'user@example.com',
          emailVerified: true,
          providerName: 'google',
        });

        expect(mockUsersInsertOne).toHaveBeenCalledWith(
          expect.objectContaining({
            handle: 'user@example.com',
            authMethods: {
              google: { id: 'provider-id' },
            },
          })
        );
        expect(authConfig.onAfterSignup).toHaveBeenCalledWith(
          expect.objectContaining({ user: userDocument })
        );
        expect(authConfig.signup.onSuccess).toHaveBeenCalledWith(userDocument);
      });
    });
  });
});
