import type { Request, Response } from 'express';
import { ObjectId } from 'mongodb';
import { beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * Mobile OAuth paths. Kept separate from oauth-common.test.ts so the config mock
 * can distinguish the site URL from the deep-link allowlist, and so the web-flow
 * regression suite stays untouched.
 */

const mockUsersFindOne = vi.fn();
const mockUsersInsertOne = vi.fn();
const mockUsersUpdateOne = vi.fn();
const mockCreateSession = vi.fn();
const mockSetAuthTokenCookie = vi.fn();
const mockIssueOAuthExchangeCode = vi.fn();
const mockGetAuthConfig = vi.fn<() => Record<string, unknown>>();
const mockGetCallContext = vi.fn();
const mockGetConfig = vi.fn<(key: string) => unknown>();
const mockResolveUniqueHandle = vi.fn();

const ALLOWED_DEEP_LINK = 'myapp://auth';

vi.doMock('../db', () => ({
  usersCollection: {
    findOne: mockUsersFindOne,
    insertOne: mockUsersInsertOne,
    updateOne: mockUsersUpdateOne,
  },
}));

vi.doMock('../session', () => ({
  createSession: mockCreateSession,
  setAuthTokenCookie: mockSetAuthTokenCookie,
  consumeLinkNonce: vi.fn(),
  issueOAuthExchangeCode: mockIssueOAuthExchangeCode,
}));

vi.doMock('@/app/authConfig', () => ({ getAuthConfig: mockGetAuthConfig }));
vi.doMock('@/app/server', () => ({ getCallContext: mockGetCallContext }));
vi.doMock('@/config/server', () => ({ getConfig: mockGetConfig }));
vi.doMock('../utils', () => ({ resolveUniqueHandle: mockResolveUniqueHandle }));

const oauth = await import('./oauth-common');

function makeRes() {
  return {
    cookie: vi.fn(),
    clearCookie: vi.fn(),
    status: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    redirect: vi.fn(),
    json: vi.fn(),
    send: vi.fn(),
  } as unknown as Response;
}

const MOBILE_OUTCOME = { platform: 'mobile', redirectUri: ALLOWED_DEEP_LINK } as const;

describe('auth/providers/oauth-common — mobile', () => {
  let res: Response;

  beforeEach(() => {
    vi.clearAllMocks();
    res = makeRes();

    mockGetConfig.mockImplementation((key) => {
      if (key === '_system.user.auth.mobile.redirectUrls') return ALLOWED_DEEP_LINK;
      if (key === '_system.site.url') return 'https://app.example.com';
      return undefined;
    });
    mockGetAuthConfig.mockReturnValue({});
    mockGetCallContext.mockResolvedValue({
      session: { authToken: 'token' },
      connectionInfo: { ip: '1.1.1.1' },
    } as never);
    mockCreateSession.mockResolvedValue({ authToken: 'tok' } as never);
    mockIssueOAuthExchangeCode.mockResolvedValue('exchange-code');
  });

  describe('authenticateUser', () => {
    test('redirects to the deep link with a single-use code', async () => {
      const userId = new ObjectId();

      await oauth.authenticateUser(res, userId, MOBILE_OUTCOME, 'google');

      expect(mockIssueOAuthExchangeCode).toHaveBeenCalledWith(userId.toString(), 'google');
      expect(res.status).toHaveBeenCalledWith(302);
      expect(res.redirect).toHaveBeenCalledWith('myapp://auth?code=exchange-code');
    });

    // The whole point of the exchange-code design: nothing usable is created
    // until the app redeems the code over TLS.
    test('creates no session and sets no cookie', async () => {
      await oauth.authenticateUser(res, new ObjectId(), MOBILE_OUTCOME, 'google');

      expect(mockCreateSession).not.toHaveBeenCalled();
      expect(mockSetAuthTokenCookie).not.toHaveBeenCalled();
      expect(res.cookie).not.toHaveBeenCalled();
    });

    test('suppresses the referrer so the code cannot leak', async () => {
      await oauth.authenticateUser(res, new ObjectId(), MOBILE_OUTCOME, 'google');

      expect(res.set).toHaveBeenCalledWith('Referrer-Policy', 'no-referrer');
    });

    test('records the provider the code was minted for', async () => {
      await oauth.authenticateUser(res, new ObjectId(), MOBILE_OUTCOME, 'github');

      expect(mockIssueOAuthExchangeCode).toHaveBeenCalledWith(expect.any(String), 'github');
    });

    test('web flow is unchanged: session, cookie, redirect to root', async () => {
      const userId = new ObjectId();

      await oauth.authenticateUser(res, userId);

      expect(mockCreateSession).toHaveBeenCalledWith(userId);
      expect(mockSetAuthTokenCookie).toHaveBeenCalledWith(res, 'tok');
      expect(res.redirect).toHaveBeenCalledWith('/');
      expect(mockIssueOAuthExchangeCode).not.toHaveBeenCalled();
    });
  });

  describe('sendOAuthError', () => {
    test('redirects errors to the deep link instead of stranding the browser', () => {
      oauth.sendOAuthError(res, 400, 'User account is not active.', MOBILE_OUTCOME);

      expect(res.redirect).toHaveBeenCalledWith('myapp://auth?error=User+account+is+not+active.');
      expect(res.json).not.toHaveBeenCalled();
    });

    test('web errors still return JSON', () => {
      oauth.sendOAuthError(res, 400, 'Nope');

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'Nope' });
      expect(res.redirect).not.toHaveBeenCalled();
    });
  });

  describe('encodeOAuthState / validateOAuthStateAndGetMode', () => {
    test('round-trips a deep link containing colons and slashes', () => {
      const redirectUri = 'exp://127.0.0.1:19000/--/auth';
      mockGetConfig.mockImplementation((key) =>
        key === '_system.user.auth.mobile.redirectUrls' ? redirectUri : undefined
      );

      const cookie = oauth.encodeOAuthState({
        state: 'abc',
        mode: 'login',
        platform: 'mobile',
        redirectUri,
      });

      const result = oauth.validateOAuthStateAndGetMode(
        { query: { state: 'abc' }, cookies: { s: cookie } } as unknown as Request,
        res,
        's'
      );

      expect(result).toEqual({ mode: 'login', platform: 'mobile', redirectUri });
    });

    test('preserves the pre-mobile cookie format for web flows', () => {
      expect(oauth.encodeOAuthState({ state: 'abc', mode: 'login' })).toBe('abc:login:');
    });

    test('still parses legacy cookies written before mobile existed', () => {
      const result = oauth.validateOAuthStateAndGetMode(
        {
          query: { state: 'abc' },
          cookies: { s: 'abc:link:507f1f77bcf86cd799439011' },
        } as unknown as Request,
        res,
        's'
      );

      expect(result).toEqual({
        mode: 'link',
        linkedUserId: '507f1f77bcf86cd799439011',
        platform: 'web',
      });
    });

    test('carries linkedUserId alongside the mobile fields', () => {
      const cookie = oauth.encodeOAuthState({
        state: 'abc',
        mode: 'link',
        linkedUserId: '507f1f77bcf86cd799439011',
        platform: 'mobile',
        redirectUri: ALLOWED_DEEP_LINK,
      });

      const result = oauth.validateOAuthStateAndGetMode(
        { query: { state: 'abc' }, cookies: { s: cookie } } as unknown as Request,
        res,
        's'
      );

      expect(result).toEqual({
        mode: 'link',
        linkedUserId: '507f1f77bcf86cd799439011',
        platform: 'mobile',
        redirectUri: ALLOWED_DEEP_LINK,
      });
    });

    test('rejects a mismatched state as before', () => {
      const result = oauth.validateOAuthStateAndGetMode(
        { query: { state: 'attacker' }, cookies: { s: 'abc:login:' } } as unknown as Request,
        res,
        's'
      );

      expect(result).toBeNull();
      expect(res.status).toHaveBeenCalledWith(400);
    });

    // Defence in depth: the allowlist may have changed while the user was on the
    // provider's consent screen.
    test('re-validates the target against the allowlist on the way back', () => {
      const cookie = oauth.encodeOAuthState({
        state: 'abc',
        mode: 'login',
        platform: 'mobile',
        redirectUri: ALLOWED_DEEP_LINK,
      });
      mockGetConfig.mockImplementation(() => '');

      const result = oauth.validateOAuthStateAndGetMode(
        { query: { state: 'abc' }, cookies: { s: cookie } } as unknown as Request,
        res,
        's'
      );

      expect(result).toBeNull();
    });
  });

  describe('resolveMobileRedirectRequest', () => {
    test('passes through a non-mobile request', () => {
      const result = oauth.resolveMobileRedirectRequest({ query: {} } as unknown as Request, res);

      expect(result).toEqual({ ok: true, redirectUri: null });
    });

    test('accepts an allowlisted target', () => {
      const result = oauth.resolveMobileRedirectRequest(
        { query: { platform: 'mobile', redirectUri: ALLOWED_DEEP_LINK } } as unknown as Request,
        res
      );

      expect(result).toEqual({ ok: true, redirectUri: ALLOWED_DEEP_LINK });
    });

    // Fails before the provider redirect, so the user never reaches a consent
    // screen for a flow that cannot complete.
    test('rejects a target that is not allowlisted', () => {
      const result = oauth.resolveMobileRedirectRequest(
        { query: { platform: 'mobile', redirectUri: 'evil://auth' } } as unknown as Request,
        res
      );

      expect(result).toEqual({ ok: false });
      expect(res.status).toHaveBeenCalledWith(400);
    });

    test('rejects a mobile request with no target', () => {
      const result = oauth.resolveMobileRedirectRequest(
        { query: { platform: 'mobile' } } as unknown as Request,
        res
      );

      expect(result).toEqual({ ok: false });
    });
  });

  describe('handleOAuthUserAuthentication', () => {
    const userData = {
      id: 'provider-id',
      email: 'user@example.com',
      emailVerified: true,
      providerName: 'google',
    } as const;

    test('existing user signs in to the deep link', async () => {
      const userId = new ObjectId();
      mockUsersFindOne.mockResolvedValue({ _id: userId, status: 'active', handle: 'u' });

      await oauth.handleOAuthUserAuthentication(
        {} as Request,
        res,
        { ...userData },
        MOBILE_OUTCOME
      );

      expect(mockIssueOAuthExchangeCode).toHaveBeenCalledWith(userId.toString(), 'google');
      expect(res.redirect).toHaveBeenCalledWith('myapp://auth?code=exchange-code');
    });

    test('new user signs up to the deep link', async () => {
      const insertedId = new ObjectId();
      mockUsersFindOne.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
      mockUsersInsertOne.mockResolvedValue({ insertedId });
      mockUsersFindOne.mockResolvedValue(null);
      mockResolveUniqueHandle.mockResolvedValue('user');

      await oauth.handleOAuthUserAuthentication(
        {} as Request,
        res,
        { ...userData },
        MOBILE_OUTCOME
      );

      expect(mockIssueOAuthExchangeCode).toHaveBeenCalledWith(insertedId.toString(), 'google');
    });

    test('a disabled account returns the error via the deep link', async () => {
      mockUsersFindOne.mockResolvedValue({
        _id: new ObjectId(),
        status: 'disabled',
        handle: 'u',
      });

      await oauth.handleOAuthUserAuthentication(
        {} as Request,
        res,
        { ...userData },
        MOBILE_OUTCOME
      );

      expect(res.redirect).toHaveBeenCalledWith('myapp://auth?error=User+account+is+not+active.');
      expect(mockIssueOAuthExchangeCode).not.toHaveBeenCalled();
    });
  });

  describe('handleOAuthProviderLink', () => {
    test('returns to the deep link without a code', async () => {
      const userId = new ObjectId();
      mockUsersUpdateOne.mockResolvedValue({ matchedCount: 1 });
      mockUsersFindOne.mockResolvedValue({ _id: userId, status: 'active', handle: 'u' });
      mockGetCallContext.mockResolvedValue({
        session: { authToken: 'token', userId },
        connectionInfo: { ip: '1.1.1.1' },
      } as never);

      await oauth.handleOAuthProviderLink(
        {} as Request,
        res,
        {
          id: 'provider-id',
          email: 'user@example.com',
          emailVerified: true,
          providerName: 'github',
        },
        undefined,
        MOBILE_OUTCOME
      );

      // Linking happens for an already-signed-in user: no new session to hand over.
      expect(res.redirect).toHaveBeenCalledWith('myapp://auth?linked=github');
      expect(mockIssueOAuthExchangeCode).not.toHaveBeenCalled();
    });
  });
});
