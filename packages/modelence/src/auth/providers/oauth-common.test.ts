import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import type { Request, Response } from 'express';
import { ObjectId } from 'mongodb';

const mockUsersFindOne = jest.fn();
const mockUsersInsertOne = jest.fn();
const mockCreateSession = jest.fn();
const mockGetAuthConfig = jest.fn();
const mockGetCallContext = jest.fn();
const mockGetConfig = jest.fn();

jest.unstable_mockModule('../db', () => ({
  usersCollection: {
    findOne: mockUsersFindOne,
    insertOne: mockUsersInsertOne,
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
    test('logs in existing user via provider id', async () => {
      const existingUser = { _id: new ObjectId(), handle: 'demo' };
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

    test('prevents signup when email already exists', async () => {
      mockUsersFindOne.mockResolvedValueOnce(null as never).mockResolvedValueOnce({
        _id: new ObjectId(),
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
    });

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
