import type { Request, Response } from 'express';
import { ObjectId } from 'mongodb';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const mockUsersFindOne = vi.fn();
const mockUsersInsertOne = vi.fn();
const mockUsersUpdateOne = vi.fn();
const mockCreateSession = vi.fn();
const mockSetAuthTokenCookie = vi.fn();
const mockIssueOAuthExchangeCode = vi.fn();
const mockGetAuthConfig = vi.fn<() => Record<string, unknown>>();
const mockGetCallContext = vi.fn();
const mockGetConfig = vi.fn<(key: string) => unknown>();
const mockConsumeLinkNonce = vi.fn();

const DEEP_LINK = 'myapp://auth';
const CHALLENGE = 'c'.repeat(64);

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
  consumeLinkNonce: mockConsumeLinkNonce,
  issueOAuthExchangeCode: mockIssueOAuthExchangeCode,
}));
vi.doMock('@/app/authConfig', () => ({ getAuthConfig: mockGetAuthConfig }));
vi.doMock('@/app/server', () => ({ getCallContext: mockGetCallContext }));
vi.doMock('@/config/server', () => ({ getConfig: mockGetConfig }));
vi.doMock('../utils', () => ({ resolveUniqueHandle: vi.fn(async () => 'demo') }));

const oauth = await import('./oauthCommon');

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

/** Full round trip: initiation -> state cookie -> callback validation -> outcome. */
async function roundTrip(query: Record<string, string>, res: Response) {
  const init = await oauth.prepareOAuthInitiation(
    { query } as unknown as Request,
    res,
    'authStateGoogle'
  );
  if (!init) return null;

  const cookieValue = (res.cookie as unknown as { mock: { calls: string[][] } }).mock.calls[0][1];

  const stateResult = oauth.validateOAuthStateAndGetMode(
    {
      query: { state: init.state },
      cookies: { authStateGoogle: cookieValue },
    } as unknown as Request,
    res,
    'authStateGoogle'
  );
  if (!stateResult) return null;

  return { init, stateResult, outcome: oauth.toOAuthOutcome(stateResult) };
}

/**
 * End-to-end invariants for the mobile OAuth surface.
 *
 * Every other suite here exercises one function. These drive the real sequence —
 * initiation writes a state cookie, the callback validates it, the outcome is
 * derived from it — because the regressions this feature actually shipped all
 * lived in the seams between those steps, not inside any one of them.
 */
describe('oauthCommon — mobile end-to-end invariants', () => {
  let res: Response;

  beforeEach(() => {
    vi.clearAllMocks();
    res = makeRes();
    mockGetConfig.mockImplementation((k) =>
      k === '_system.user.auth.mobile.redirectUrls' ? DEEP_LINK : undefined
    );
    mockGetAuthConfig.mockReturnValue({});
    mockGetCallContext.mockResolvedValue({
      session: { authToken: 't', userId: new ObjectId() },
      connectionInfo: { ip: '1.1.1.1' },
    } as never);
    mockIssueOAuthExchangeCode.mockResolvedValue('exchange-code');
    mockCreateSession.mockResolvedValue({ authToken: 'tok' } as never);
    mockConsumeLinkNonce.mockResolvedValue(new ObjectId().toString());
  });

  // ---- INVARIANT 1: mode + platform survive the round trip intact ----
  test('I1a: mobile login round-trips as mobile with challenge', async () => {
    const r = await roundTrip(
      { mode: 'login', platform: 'mobile', redirectUri: DEEP_LINK, codeChallenge: CHALLENGE },
      res
    );
    expect(r?.stateResult.mode).toBe('login');
    expect(r?.outcome).toEqual({
      platform: 'mobile',
      redirectUri: DEEP_LINK,
      codeChallenge: CHALLENGE,
    });
  });

  test('I1b: mobile link round-trips as mobile without challenge', async () => {
    const r = await roundTrip(
      { mode: 'link', platform: 'mobile', redirectUri: DEEP_LINK, linkNonce: 'n' },
      res
    );
    expect(r?.stateResult.mode).toBe('link');
    expect(r?.outcome).toEqual({ platform: 'mobile', redirectUri: DEEP_LINK });
  });

  test('I1c: web login round-trips as web', async () => {
    const r = await roundTrip({ mode: 'login' }, res);
    expect(r?.outcome).toEqual({ platform: 'web' });
  });

  test('I1d: web link round-trips as web', async () => {
    const r = await roundTrip({ mode: 'link', linkNonce: 'n' }, res);
    expect(r?.stateResult.mode).toBe('link');
    expect(r?.outcome).toEqual({ platform: 'web' });
  });

  // ---- INVARIANT 2: a code is minted only with a binding ----
  test('I2a: bound mobile login mints a bound code', async () => {
    const r = await roundTrip(
      { mode: 'login', platform: 'mobile', redirectUri: DEEP_LINK, codeChallenge: CHALLENGE },
      res
    );
    await oauth.authenticateUser(res, new ObjectId(), 'google', r!.outcome);
    expect(mockIssueOAuthExchangeCode).toHaveBeenCalledWith(
      expect.any(String),
      'google',
      CHALLENGE
    );
  });

  test('I2b: unbound mobile outcome never mints a code', async () => {
    await oauth.authenticateUser(res, new ObjectId(), 'google', {
      platform: 'mobile',
      redirectUri: DEEP_LINK,
    });
    expect(mockIssueOAuthExchangeCode).not.toHaveBeenCalled();
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  test('I2c: challenge-less mobile login initiation is refused outright', async () => {
    const r = await roundTrip({ mode: 'login', platform: 'mobile', redirectUri: DEEP_LINK }, res);
    expect(r).toBeNull();
  });

  // ---- INVARIANT 3: a mobile flow never ends in the browser ----
  test('I3a: mobile login success deep-links', async () => {
    const r = await roundTrip(
      { mode: 'login', platform: 'mobile', redirectUri: DEEP_LINK, codeChallenge: CHALLENGE },
      res
    );
    await oauth.authenticateUser(res, new ObjectId(), 'google', r!.outcome);
    expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining('myapp://auth?code='));
  });

  test('I3b: mobile link success deep-links', async () => {
    const userId = new ObjectId();
    mockGetCallContext.mockResolvedValue({
      session: { authToken: 't', userId },
      connectionInfo: { ip: '1.1.1.1' },
    } as never);
    mockUsersUpdateOne.mockResolvedValue({ matchedCount: 1 } as never);
    mockUsersFindOne.mockResolvedValue({ _id: userId, handle: 'd' } as never);

    const r = await roundTrip(
      { mode: 'link', platform: 'mobile', redirectUri: DEEP_LINK, linkNonce: 'n' },
      res
    );
    await oauth.handleOAuthProviderLink(
      {} as Request,
      res,
      { id: 'g', email: 'e@x.com', emailVerified: true, providerName: 'google' },
      r!.stateResult.linkedUserId,
      r!.outcome
    );
    expect(res.redirect).toHaveBeenCalledWith('myapp://auth?linked=google');
    expect(res.redirect).not.toHaveBeenCalledWith('/');
  });

  test('I3c: mobile error deep-links', async () => {
    oauth.sendOAuthError(
      res,
      400,
      'nope',
      { platform: 'mobile', redirectUri: DEEP_LINK },
      'oauth_failed'
    );
    expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining('myapp://auth?error='));
  });

  // ---- INVARIANT 4: no cookie session is created for a mobile flow ----
  test('I4: mobile login sets no auth cookie', async () => {
    const r = await roundTrip(
      { mode: 'login', platform: 'mobile', redirectUri: DEEP_LINK, codeChallenge: CHALLENGE },
      res
    );
    await oauth.authenticateUser(res, new ObjectId(), 'google', r!.outcome);
    expect(mockSetAuthTokenCookie).not.toHaveBeenCalled();
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  // ---- INVARIANT 5: tampering cannot upgrade privilege ----
  test('I5a: a link state cannot be replayed as a login', async () => {
    const r = await roundTrip(
      { mode: 'link', platform: 'mobile', redirectUri: DEEP_LINK, linkNonce: 'n' },
      res
    );
    // mode comes from the httpOnly cookie, not the query string
    expect(r?.stateResult.mode).toBe('link');
  });

  test('I5b: query-string mode at callback cannot override the cookie', async () => {
    const init = await oauth.prepareOAuthInitiation(
      { query: { mode: 'link', linkNonce: 'n' } } as unknown as Request,
      res,
      'authStateGoogle'
    );
    const cookieValue = (res.cookie as unknown as { mock: { calls: string[][] } }).mock.calls[0][1];
    const stateResult = oauth.validateOAuthStateAndGetMode(
      {
        query: { state: init!.state, mode: 'login' },
        cookies: { authStateGoogle: cookieValue },
      } as unknown as Request,
      res,
      'authStateGoogle'
    );
    expect(stateResult?.mode).toBe('link');
  });
});

/**
 * Forged, truncated and injected state. The state cookie is httpOnly and
 * integrity-checked, but these confirm that a value which nonetheless reaches
 * the decoder cannot escalate into a minted credential.
 */
describe('oauthCommon — mobile state tampering', () => {
  let res: Response;
  beforeEach(() => {
    vi.clearAllMocks();
    res = makeRes();
    mockGetConfig.mockImplementation((k) =>
      k === '_system.user.auth.mobile.redirectUrls' ? DEEP_LINK : undefined
    );
    mockIssueOAuthExchangeCode.mockResolvedValue('code');
    mockCreateSession.mockResolvedValue({ authToken: 'tok' } as never);
  });

  // A hand-forged cookie claiming mobile+challenge but for an unlisted target.
  test('forged cookie with unlisted target is refused', () => {
    const forged = oauth.encodeOAuthState({
      state: 's',
      mode: 'login',
      platform: 'mobile',
      redirectUri: 'evil://steal',
      codeChallenge: CHALLENGE,
    });
    const r = oauth.validateOAuthStateAndGetMode(
      { query: { state: 's' }, cookies: { authStateGoogle: forged } } as unknown as Request,
      res,
      'authStateGoogle'
    );
    expect(r).toBeNull();
  });

  // Truncated cookie: mobile platform but the challenge field is missing.
  test('truncated mobile cookie yields an unbound outcome that cannot mint', async () => {
    const truncated = [
      's',
      'login',
      '',
      'mobile',
      Buffer.from(DEEP_LINK, 'utf8').toString('base64url'),
    ].join(':');
    const r = oauth.validateOAuthStateAndGetMode(
      { query: { state: 's' }, cookies: { authStateGoogle: truncated } } as unknown as Request,
      res,
      'authStateGoogle'
    );
    const outcome = oauth.toOAuthOutcome(r!);
    expect(oauth.isBoundMobileOutcome(outcome)).toBe(false);

    await oauth.authenticateUser(res, new ObjectId(), 'google', outcome);
    expect(mockIssueOAuthExchangeCode).not.toHaveBeenCalled();
    expect(mockCreateSession).not.toHaveBeenCalled();
    // and it still reports back into the app rather than the browser
    expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining('myapp://auth?error='));
  });

  // Challenge injected only at the callback (not present at initiation).
  test('callback query cannot inject a challenge', () => {
    const cookie = [
      's',
      'login',
      '',
      'mobile',
      Buffer.from(DEEP_LINK, 'utf8').toString('base64url'),
    ].join(':');
    const r = oauth.validateOAuthStateAndGetMode(
      {
        query: { state: 's', codeChallenge: CHALLENGE },
        cookies: { authStateGoogle: cookie },
      } as unknown as Request,
      res,
      'authStateGoogle'
    );
    expect(r?.codeChallenge).toBeUndefined();
  });

  // redirectUri injected at the callback rather than coming from the cookie.
  test('callback query cannot inject a redirectUri', () => {
    const cookie = oauth.encodeOAuthState({ state: 's', mode: 'login' });
    const r = oauth.validateOAuthStateAndGetMode(
      {
        query: { state: 's', redirectUri: DEEP_LINK, platform: 'mobile' },
        cookies: { authStateGoogle: cookie },
      } as unknown as Request,
      res,
      'authStateGoogle'
    );
    expect(oauth.toOAuthOutcome(r!)).toEqual({ platform: 'web' });
  });

  // A challenge containing the cookie delimiter must never be stored raw.
  test('a colon-bearing challenge is rejected at initiation', async () => {
    const r = await oauth.prepareOAuthInitiation(
      {
        query: { platform: 'mobile', redirectUri: DEEP_LINK, codeChallenge: 'a:b:c' },
      } as unknown as Request,
      res,
      'authStateGoogle'
    );
    expect(r).toBeNull();
    expect(res.cookie).not.toHaveBeenCalled();
  });

  // A redirectUri containing a colon must survive intact (it is base64url'd).
  test('a redirectUri with colons and slashes round-trips exactly', () => {
    const tricky = 'myapp://auth';
    const cookie = oauth.encodeOAuthState({
      state: 's',
      mode: 'login',
      platform: 'mobile',
      redirectUri: tricky,
      codeChallenge: CHALLENGE,
    });
    const r = oauth.validateOAuthStateAndGetMode(
      { query: { state: 's' }, cookies: { authStateGoogle: cookie } } as unknown as Request,
      res,
      'authStateGoogle'
    );
    expect(r?.redirectUri).toBe(tricky);
  });

  // An empty/missing cookie must not be treated as a valid web state.
  test('an absent cookie is rejected', () => {
    const r = oauth.validateOAuthStateAndGetMode(
      { query: { state: 's' }, cookies: {} } as unknown as Request,
      res,
      'authStateGoogle'
    );
    expect(r).toBeNull();
  });

  // Empty state on both sides must not match.
  test('empty state on both sides does not authenticate', () => {
    const r = oauth.validateOAuthStateAndGetMode(
      { query: {}, cookies: { authStateGoogle: '' } } as unknown as Request,
      res,
      'authStateGoogle'
    );
    expect(r).toBeNull();
  });
});
