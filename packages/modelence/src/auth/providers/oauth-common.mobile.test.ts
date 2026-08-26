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

      await oauth.authenticateUser(res, userId, 'google', MOBILE_OUTCOME);

      expect(mockIssueOAuthExchangeCode).toHaveBeenCalledWith(
        userId.toString(),
        'google',
        undefined
      );
      expect(res.redirect).toHaveBeenCalledWith('myapp://auth?code=exchange-code');
    });

    // The whole point of the exchange-code design: nothing usable is created
    // until the app redeems the code over TLS.
    test('creates no session and sets no cookie', async () => {
      await oauth.authenticateUser(res, new ObjectId(), 'google', MOBILE_OUTCOME);

      expect(mockCreateSession).not.toHaveBeenCalled();
      expect(mockSetAuthTokenCookie).not.toHaveBeenCalled();
      expect(res.cookie).not.toHaveBeenCalled();
    });

    test('suppresses the referrer so the code cannot leak', async () => {
      await oauth.authenticateUser(res, new ObjectId(), 'google', MOBILE_OUTCOME);

      expect(res.set).toHaveBeenCalledWith('Referrer-Policy', 'no-referrer');
    });

    test('records the provider the code was minted for', async () => {
      await oauth.authenticateUser(res, new ObjectId(), 'github', MOBILE_OUTCOME);

      expect(mockIssueOAuthExchangeCode).toHaveBeenCalledWith(
        expect.any(String),
        'github',
        undefined
      );
    });

    test('web flow is unchanged: session, cookie, redirect to root', async () => {
      const userId = new ObjectId();

      await oauth.authenticateUser(res, userId, 'google');

      expect(mockCreateSession).toHaveBeenCalledWith(userId);
      expect(mockSetAuthTokenCookie).toHaveBeenCalledWith(res, 'tok');
      expect(res.redirect).toHaveBeenCalledWith('/');
      expect(mockIssueOAuthExchangeCode).not.toHaveBeenCalled();
    });
  });

  describe('sendOAuthError', () => {
    test('redirects errors to the deep link instead of stranding the browser', () => {
      oauth.sendOAuthError(res, 400, 'User account is not active.', MOBILE_OUTCOME);

      expect(res.redirect).toHaveBeenCalledWith(
        'myapp://auth?error=User+account+is+not+active.&errorCode=oauth_failed'
      );
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

      expect(result).toEqual({ ok: true, redirectUri: null, codeChallenge: null });
    });

    test('accepts an allowlisted target', () => {
      const result = oauth.resolveMobileRedirectRequest(
        { query: { platform: 'mobile', redirectUri: ALLOWED_DEEP_LINK } } as unknown as Request,
        res
      );

      expect(result).toEqual({
        ok: true,
        redirectUri: ALLOWED_DEEP_LINK,
        codeChallenge: null,
      });
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

      expect(mockIssueOAuthExchangeCode).toHaveBeenCalledWith(
        userId.toString(),
        'google',
        undefined
      );
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

      expect(mockIssueOAuthExchangeCode).toHaveBeenCalledWith(
        insertedId.toString(),
        'google',
        undefined
      );
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

      expect(res.redirect).toHaveBeenCalledWith(
        'myapp://auth?error=User+account+is+not+active.&errorCode=oauth_failed'
      );
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
  /**
   * The callback runs in the device browser against a throwaway guest session,
   * and the sign-in only becomes real when the app redeems the exchange code.
   * Firing the login hooks here too delivered them twice per mobile sign-in,
   * the first time with a session belonging to nobody.
   */
  describe('login hooks on the mobile callback', () => {
    const userId = new ObjectId();
    const existingUser = {
      _id: userId,
      handle: 'demo',
      status: 'active',
      emails: [{ address: 'user@example.com', verified: true }],
      authMethods: { google: { id: 'google-id' } },
    };

    const userData = {
      id: 'google-id',
      email: 'user@example.com',
      emailVerified: true,
      providerName: 'google' as const,
    };

    test('does not fire onAfterLogin or login.onSuccess on mobile', async () => {
      const onAfterLogin = vi.fn();
      const onSuccess = vi.fn();
      mockGetAuthConfig.mockReturnValue({ onAfterLogin, login: { onSuccess } });
      mockUsersFindOne.mockResolvedValueOnce(existingUser as never);

      await oauth.handleOAuthUserAuthentication({} as Request, res, userData, MOBILE_OUTCOME);

      expect(onAfterLogin).not.toHaveBeenCalled();
      expect(onSuccess).not.toHaveBeenCalled();
    });

    // The web flow is unchanged: its session is real at this point.
    test('still fires them on the web flow', async () => {
      const onAfterLogin = vi.fn();
      const onSuccess = vi.fn();
      mockGetAuthConfig.mockReturnValue({ onAfterLogin, login: { onSuccess } });
      mockUsersFindOne.mockResolvedValueOnce(existingUser as never);

      await oauth.handleOAuthUserAuthentication({} as Request, res, userData, {
        platform: 'web',
      });

      expect(onAfterLogin).toHaveBeenCalledTimes(1);
      expect(onSuccess).toHaveBeenCalledTimes(1);
    });

    // Signup hooks describe account creation, which really does happen here,
    // and the redemption path cannot tell a new account from a returning one.
    test('still fires signup hooks on mobile', async () => {
      const onAfterSignup = vi.fn();
      mockGetAuthConfig.mockReturnValue({ onAfterSignup });
      mockUsersFindOne.mockResolvedValueOnce(null as never).mockResolvedValueOnce(null as never);
      mockResolveUniqueHandle.mockResolvedValue('demo' as never);
      mockUsersInsertOne.mockResolvedValue({ insertedId: userId } as never);
      mockUsersFindOne.mockResolvedValueOnce({ _id: userId, handle: 'demo' } as never);

      await oauth.handleOAuthUserAuthentication({} as Request, res, userData, MOBILE_OUTCOME);

      expect(onAfterSignup).toHaveBeenCalledTimes(1);
    });
  });

  describe('device binding on the mobile callback', () => {
    test('carries the challenge from the state cookie into the exchange code', async () => {
      await oauth.authenticateUser(res, new ObjectId(), 'google', {
        platform: 'mobile',
        redirectUri: ALLOWED_DEEP_LINK,
        codeChallenge: 'device-challenge',
      });

      expect(mockIssueOAuthExchangeCode).toHaveBeenCalledWith(
        expect.any(String),
        'google',
        'device-challenge'
      );
    });

    test('round-trips the challenge through the state cookie', () => {
      const stateValue = oauth.encodeOAuthState({
        state: 'state-abc',
        mode: 'login',
        platform: 'mobile',
        redirectUri: ALLOWED_DEEP_LINK,
        codeChallenge: 'device-challenge',
      });

      const result = oauth.validateOAuthStateAndGetMode(
        {
          query: { state: 'state-abc' },
          cookies: { authStateGoogle: stateValue },
        } as unknown as Request,
        res,
        'authStateGoogle'
      );

      expect(result?.codeChallenge).toBe('device-challenge');
    });
  });

  /**
   * Every one of these previously ended as raw JSON in the device browser, with
   * no route back into the app.
   */
  describe('errors that must deep-link back into the app', () => {
    test('a state mismatch redirects to the app when the target re-validates', () => {
      const stateValue = oauth.encodeOAuthState({
        state: 'expected-state',
        mode: 'login',
        platform: 'mobile',
        redirectUri: ALLOWED_DEEP_LINK,
      });

      const result = oauth.validateOAuthStateAndGetMode(
        {
          query: { state: 'attacker-state' },
          cookies: { authStateGoogle: stateValue },
        } as unknown as Request,
        res,
        'authStateGoogle'
      );

      expect(result).toBeNull();
      expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining('errorCode=invalid_state'));
    });

    // The decoded target is only trusted because the allowlist just approved
    // it — a cookie naming an unlisted target still gets the JSON response.
    test('a state mismatch does not deep-link to a target off the allowlist', () => {
      const stateValue = oauth.encodeOAuthState({
        state: 'expected-state',
        mode: 'login',
        platform: 'mobile',
        redirectUri: 'evil://steal',
      });

      oauth.validateOAuthStateAndGetMode(
        {
          query: { state: 'attacker-state' },
          cookies: { authStateGoogle: stateValue },
        } as unknown as Request,
        res,
        'authStateGoogle'
      );

      expect(res.redirect).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalled();
    });

    test('recovers the deep link from the cookie when the provider sent no code', () => {
      const stateValue = oauth.encodeOAuthState({
        state: 'state-abc',
        mode: 'login',
        platform: 'mobile',
        redirectUri: ALLOWED_DEEP_LINK,
      });

      const outcome = oauth.resolveMobileOutcomeFromCookie(
        { cookies: { authStateGoogle: stateValue } } as unknown as Request,
        'authStateGoogle'
      );

      expect(outcome).toEqual({ platform: 'mobile', redirectUri: ALLOWED_DEEP_LINK });
    });

    test('recovers nothing for a web flow', () => {
      const stateValue = oauth.encodeOAuthState({ state: 'state-abc', mode: 'login' });

      expect(
        oauth.resolveMobileOutcomeFromCookie(
          { cookies: { authStateGoogle: stateValue } } as unknown as Request,
          'authStateGoogle'
        )
      ).toBeNull();
    });

    test('recovers nothing when there is no cookie at all', () => {
      expect(
        oauth.resolveMobileOutcomeFromCookie(
          { cookies: {} } as unknown as Request,
          'authStateGoogle'
        )
      ).toBeNull();
    });
  });

  describe('prepareOAuthInitiation', () => {
    test('writes a state cookie and returns the state for the provider URL', async () => {
      const result = await oauth.prepareOAuthInitiation(
        { query: {} } as unknown as Request,
        res,
        'authStateGoogle'
      );

      expect(result?.mode).toBe('login');
      expect(res.cookie).toHaveBeenCalledWith(
        'authStateGoogle',
        expect.any(String),
        expect.objectContaining({ httpOnly: true, sameSite: 'lax' })
      );
    });

    test('records the mobile handoff and challenge in the cookie', async () => {
      const result = await oauth.prepareOAuthInitiation(
        {
          query: {
            platform: 'mobile',
            redirectUri: ALLOWED_DEEP_LINK,
            codeChallenge: 'a'.repeat(64),
          },
        } as unknown as Request,
        res,
        'authStateGoogle'
      );

      expect(result).not.toBeNull();
      const cookieValue = (res.cookie as unknown as { mock: { calls: string[][] } }).mock
        .calls[0][1];
      expect(cookieValue).toContain('mobile');
      expect(cookieValue).toContain('a'.repeat(64));
    });

    // Colons are the state cookie's field delimiter, so a value carrying one
    // would corrupt the decode rather than bind anything.
    test('drops a malformed challenge instead of trusting it', async () => {
      await oauth.prepareOAuthInitiation(
        {
          query: {
            platform: 'mobile',
            redirectUri: ALLOWED_DEEP_LINK,
            codeChallenge: 'has:colons:and:more',
          },
        } as unknown as Request,
        res,
        'authStateGoogle'
      );

      const cookieValue = (res.cookie as unknown as { mock: { calls: string[][] } }).mock
        .calls[0][1];
      expect(cookieValue).not.toContain('has:colons');
    });

    test('rejects a target that is not allowlisted before reaching the provider', async () => {
      const result = await oauth.prepareOAuthInitiation(
        { query: { platform: 'mobile', redirectUri: 'evil://steal' } } as unknown as Request,
        res,
        'authStateGoogle'
      );

      expect(result).toBeNull();
      expect(res.cookie).not.toHaveBeenCalled();
    });
  });
  // Previously this stranded the user on JSON in the device browser even though
  // the redirect target had been validated a few lines earlier.
  describe('expired link nonce during initiation', () => {
    test('deep-links the failure back into the app', async () => {
      const result = await oauth.prepareOAuthInitiation(
        {
          query: {
            mode: 'link',
            linkNonce: 'expired-nonce',
            platform: 'mobile',
            redirectUri: ALLOWED_DEEP_LINK,
          },
        } as unknown as Request,
        res,
        'authStateGoogle'
      );

      expect(result).toBeNull();
      expect(res.redirect).toHaveBeenCalledWith(
        expect.stringContaining('errorCode=invalid_link_nonce')
      );
    });

    test('still responds with JSON for a web link flow', async () => {
      const result = await oauth.prepareOAuthInitiation(
        { query: { mode: 'link', linkNonce: 'expired-nonce' } } as unknown as Request,
        res,
        'authStateGoogle'
      );

      expect(result).toBeNull();
      expect(res.redirect).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalled();
    });
  });
  /**
   * A rolling deploy runs both versions at once, so a state cookie written by
   * one may be read by the other. Positional fields make both directions safe:
   * an extra trailing field is ignored, and a missing one reads as absent.
   */
  describe('state cookie compatibility across a rolling deploy', () => {
    test('an older 5-field mobile cookie still decodes as mobile', () => {
      const legacy = [
        'state-abc',
        'login',
        '',
        'mobile',
        Buffer.from(ALLOWED_DEEP_LINK, 'utf8').toString('base64url'),
      ].join(':');

      const result = oauth.validateOAuthStateAndGetMode(
        {
          query: { state: 'state-abc' },
          cookies: { authStateGoogle: legacy },
        } as unknown as Request,
        res,
        'authStateGoogle'
      );

      expect(result?.platform).toBe('mobile');
      expect(result?.redirectUri).toBe(ALLOWED_DEEP_LINK);
      // No binding was recorded, so redemption stays possible for that client.
      expect(result?.codeChallenge).toBeUndefined();
    });

    test('a web cookie is unchanged by the added field', () => {
      expect(oauth.encodeOAuthState({ state: 'state-abc', mode: 'login' })).toBe(
        'state-abc:login:'
      );
    });
  });
});
