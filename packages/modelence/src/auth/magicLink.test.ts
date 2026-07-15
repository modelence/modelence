import { afterAll, afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { MockedFunction } from 'vitest';
import { ObjectId, MongoServerError } from 'mongodb';
import { createHash as actualCreateHash } from 'crypto';
import type { Context } from '@/methods/types';
import type { Session } from './types';
import type { usersCollection, magicLinkTokensCollection } from './db';

const sha256 = (value: string) => actualCreateHash('sha256').update(value).digest('hex');

type UsersCollection = typeof usersCollection;
type MagicLinkTokensCollection = typeof magicLinkTokensCollection;

const mockUsersFindOne: MockedFunction<UsersCollection['findOne']> = vi.fn();
const mockUsersUpdateOne: MockedFunction<UsersCollection['updateOne']> = vi.fn();
const mockUsersInsertOne: MockedFunction<UsersCollection['insertOne']> = vi.fn();
const mockTokensInsertOne: MockedFunction<MagicLinkTokensCollection['insertOne']> = vi.fn();
const mockTokensFindOne: MockedFunction<MagicLinkTokensCollection['findOne']> = vi.fn();
const mockTokensFindOneAndDelete: MockedFunction<MagicLinkTokensCollection['findOneAndDelete']> =
  vi.fn();
const mockTokensUpdateMany: MockedFunction<MagicLinkTokensCollection['updateMany']> = vi.fn();
const mockGetEmailConfig = vi.fn();
const mockGetAuthConfig = vi.fn();
const mockHtmlToText: MockedFunction<(html: string) => string> = vi.fn();
const mockValidateEmail: MockedFunction<(email: string) => string> = vi.fn();
const mockRandomBytes = vi.fn();
const mockRandomInt = vi.fn();
const mockTime = { minutes: vi.fn() };
const mockConsumeRateLimit = vi.fn();
const mockGetConfig = vi.fn();
const mockIsDisposableEmail = vi.fn();
const mockSetSessionUser = vi.fn();
const mockSetAuthTokenCookie = vi.fn();
const mockResolveUniqueHandle = vi.fn();
const mockSerializeUserForClient = vi.fn();

vi.doMock('./session', () => ({
  setSessionUser: mockSetSessionUser,
  setAuthTokenCookie: mockSetAuthTokenCookie,
}));

vi.doMock('@/server', () => ({
  consumeRateLimit: mockConsumeRateLimit,
}));

vi.doMock('@/config/server', () => ({
  getConfig: mockGetConfig,
  getPublicConfigs: vi.fn().mockReturnValue({}),
}));

vi.doMock('./db', () => ({
  usersCollection: {
    findOne: mockUsersFindOne,
    updateOne: mockUsersUpdateOne,
    insertOne: mockUsersInsertOne,
  },
  magicLinkTokensCollection: {
    insertOne: mockTokensInsertOne,
    findOne: mockTokensFindOne,
    findOneAndDelete: mockTokensFindOneAndDelete,
    updateMany: mockTokensUpdateMany,
  },
}));

vi.doMock('@/app/emailConfig', () => ({
  getEmailConfig: mockGetEmailConfig,
}));

vi.doMock('@/app/authConfig', () => ({
  getAuthConfig: mockGetAuthConfig,
}));

vi.doMock('@/utils', () => ({
  htmlToText: mockHtmlToText,
}));

vi.doMock('./validators', () => ({
  validateEmail: mockValidateEmail,
}));

vi.doMock('./disposableEmails', () => ({
  isDisposableEmail: mockIsDisposableEmail,
}));

vi.doMock('./utils', () => ({
  resolveUrl: (baseUrl: string, configuredUrl?: string) => {
    if (!configuredUrl) return baseUrl;
    if (configuredUrl.startsWith('http://') || configuredUrl.startsWith('https://')) {
      return configuredUrl;
    }
    return `${baseUrl}${configuredUrl.startsWith('/') ? '' : '/'}${configuredUrl}`;
  },
  resolveUniqueHandle: mockResolveUniqueHandle,
  serializeUserForClient: mockSerializeUserForClient,
  isDuplicateEmailError: (error: unknown) =>
    error instanceof MongoServerError &&
    error.code === 11000 &&
    typeof error.keyPattern === 'object' &&
    error.keyPattern !== null &&
    'emails.address' in error.keyPattern,
}));

vi.doMock('crypto', () => ({
  randomBytes: mockRandomBytes,
  randomInt: mockRandomInt,
  // tokenHash.ts (imported transitively) needs the real createHash.
  createHash: actualCreateHash,
}));

vi.doMock('@/time', () => ({
  time: mockTime,
}));

const magicLinkModule = await import('./magicLink');
const {
  handleSendMagicLink,
  handleMagicLinkLanding,
  handleLoginWithMagicLink,
  handleLoginWithOneTimeCode,
} = magicLinkModule;

const createSession = (overrides: Partial<Session> = {}): Session => ({
  authToken: 'session-auth-token',
  expiresAt: new Date(Date.now() + 1e7),
  userId: null,
  ...overrides,
});

const createContext = (overrides: Partial<Context> = {}): Context => ({
  session: overrides.session ?? null,
  user: overrides.user ?? null,
  roles: overrides.roles ?? [],
  clientInfo: {
    screenWidth: 0,
    screenHeight: 0,
    windowWidth: 0,
    windowHeight: 0,
    pixelRatio: 1,
    orientation: null,
    ...(overrides.clientInfo ?? {}),
  },
  connectionInfo: {
    ...(overrides.connectionInfo ?? {}),
  },
  req: overrides.req ?? null,
  res: overrides.res ?? null,
});

const createLoginContext = ({
  cookieToken,
  session = createSession(),
  connectionInfo = {},
}: {
  cookieToken?: string;
  session?: Session;
  connectionInfo?: Context['connectionInfo'];
} = {}) => {
  const clearCookie = vi.fn();
  const cookie = vi.fn();
  const context = {
    ...createContext({ session, connectionInfo }),
    req: { cookies: cookieToken === undefined ? {} : { magicLinkToken: cookieToken } },
    res: { clearCookie, cookie },
  };
  return { context: context as never as Context, clearCookie };
};

const createMockUser = (
  overrides: Partial<{
    _id: ObjectId;
    handle: string;
    emails: { address: string; verified: boolean }[];
    status: 'active' | 'disabled' | 'deleted';
    createdAt: Date;
    authMethods: {
      password?: { hash: string };
      google?: { id: string };
      github?: { id: string };
    };
  }> = {}
) =>
  ({
    _id: overrides._id ?? new ObjectId(),
    handle: overrides.handle ?? 'testuser',
    emails: overrides.emails ?? [{ address: 'test@example.com', verified: true }],
    status: overrides.status ?? 'active',
    createdAt: overrides.createdAt ?? new Date(),
    authMethods: overrides.authMethods ?? {},
  }) as Awaited<ReturnType<UsersCollection['findOne']>>;

const createMockToken = (
  overrides: Partial<{
    _id: ObjectId;
    email: string;
    token: string;
    code: string;
    attempts: number;
    expiresAt: Date;
    createdAt: Date;
  }> = {}
) =>
  ({
    _id: overrides._id ?? new ObjectId(),
    email: overrides.email ?? 'user@example.com',
    token: overrides.token ?? 'token123',
    code: overrides.code ?? sha256('482193'),
    attempts: overrides.attempts ?? 0,
    expiresAt: overrides.expiresAt ?? new Date(Date.now() + 1000000),
    createdAt: overrides.createdAt ?? new Date(),
  }) as Awaited<ReturnType<MagicLinkTokensCollection['findOne']>>;

const GENERIC_RESPONSE = {
  success: true,
  message: 'If this email can be used to sign in, a link has been sent',
};

describe('auth/magicLink', () => {
  const mockEmailProvider = {
    sendEmail: vi.fn(async (_message: unknown) => {}),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetEmailConfig.mockReturnValue({
      provider: mockEmailProvider,
      from: 'test@example.com',
      magicLink: {
        subject: 'Your sign-in link',
        redirectUrl: '/auth/magic-link',
      },
    });
    // magicLink enabled with signup allowed by default; individual tests
    // override this to exercise the allowSignup=false default.
    mockGetAuthConfig.mockReturnValue({ magicLink: { enabled: true, allowSignup: true } });
    mockConsumeRateLimit.mockResolvedValue(undefined as never);
    mockHtmlToText.mockImplementation((html: string) => html.replace(/<[^>]*>/g, ''));
    mockTime.minutes.mockReturnValue(900000); // 15 minutes in ms
    mockIsDisposableEmail.mockResolvedValue(false as never);
    mockRandomInt.mockReturnValue(482193);
    mockSerializeUserForClient.mockImplementation((userDoc: { _id: unknown; handle: string }) => ({
      id: userDoc._id,
      handle: userDoc.handle,
    }));
    // _system.site.url configured by default
    mockGetConfig.mockReturnValue('https://example.com');
  });

  describe('handleSendMagicLink', () => {
    test('throws when magic link auth is not enabled', async () => {
      mockGetAuthConfig.mockReturnValue({});

      await expect(
        handleSendMagicLink({ email: 'user@example.com' }, createContext())
      ).rejects.toThrow('Magic link authentication is not enabled');

      expect(mockTokensInsertOne).not.toHaveBeenCalled();
      expect(mockEmailProvider.sendEmail).not.toHaveBeenCalled();
    });

    test('checks rate limits (ip and email) before sending email', async () => {
      const email = 'user@example.com';
      const ip = '127.0.0.1';

      mockValidateEmail.mockReturnValue(email);
      mockUsersFindOne.mockResolvedValue(null);
      mockRandomBytes.mockReturnValue({ toString: () => 'token' });

      await handleSendMagicLink({ email }, createContext({ connectionInfo: { ip } }));

      expect(mockConsumeRateLimit).toHaveBeenCalledWith({
        bucket: 'magicLink',
        type: 'ip',
        value: ip,
      });
      expect(mockConsumeRateLimit).toHaveBeenCalledWith({
        bucket: 'magicLink',
        type: 'email',
        value: email,
      });
    });

    test('sends a link for an unknown email (signup case) and returns generic response', async () => {
      const email = 'newuser@example.com';
      const rawToken = 'newusertoken';

      mockValidateEmail.mockReturnValue(email);
      mockUsersFindOne.mockResolvedValue(null);
      mockRandomBytes.mockReturnValue({ toString: () => rawToken });

      const result = await handleSendMagicLink({ email }, createContext());

      // Token and code are stored hashed at rest, never as the raw values.
      expect(mockTokensInsertOne).toHaveBeenCalledWith({
        email,
        token: sha256(rawToken),
        code: sha256('482193'),
        attempts: 0,
        createdAt: expect.any(Date),
        expiresAt: expect.any(Date),
      });
      // Email links to the server landing route carrying the raw token, not the SPA page.
      expect(mockEmailProvider.sendEmail).toHaveBeenCalledWith({
        to: email,
        from: 'test@example.com',
        subject: 'Your sign-in link',
        text: expect.any(String),
        html: expect.stringContaining(
          `https://example.com/api/_internal/auth/magic-link?token=${rawToken}`
        ),
      });
      // The default template renders the typed one-time code alongside the link.
      expect(mockEmailProvider.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({ html: expect.stringContaining('482193') })
      );
      expect(result).toEqual(GENERIC_RESPONSE);
    });

    test('skips sending for an unknown email when signup is not allowed (generic response)', async () => {
      mockGetAuthConfig.mockReturnValue({ magicLink: { enabled: true } });
      mockValidateEmail.mockReturnValue('newuser@example.com');
      mockUsersFindOne.mockResolvedValue(null);

      const result = await handleSendMagicLink({ email: 'newuser@example.com' }, createContext());

      // Anti-enumeration: same response as the known-email case, but no token
      // is created and no email is sent for the unknown address.
      expect(mockTokensInsertOne).not.toHaveBeenCalled();
      expect(mockEmailProvider.sendEmail).not.toHaveBeenCalled();
      expect(result).toEqual(GENERIC_RESPONSE);
    });

    test('still sends a link for an existing user when signup is not allowed', async () => {
      mockGetAuthConfig.mockReturnValue({ magicLink: { enabled: true } });
      const email = 'user@example.com';
      mockValidateEmail.mockReturnValue(email);
      mockUsersFindOne.mockResolvedValue(
        createMockUser({ emails: [{ address: email, verified: true }], status: 'active' })
      );
      mockRandomBytes.mockReturnValue({ toString: () => 'token' });

      const result = await handleSendMagicLink({ email }, createContext());

      expect(mockEmailProvider.sendEmail).toHaveBeenCalled();
      expect(result).toEqual(GENERIC_RESPONSE);
    });

    test('sends a link for an existing active user and returns the same generic response', async () => {
      const email = 'user@example.com';

      mockValidateEmail.mockReturnValue(email);
      mockUsersFindOne.mockResolvedValue(
        createMockUser({ emails: [{ address: email, verified: true }], status: 'active' })
      );
      mockRandomBytes.mockReturnValue({ toString: () => 'token' });

      const result = await handleSendMagicLink({ email }, createContext());

      expect(mockEmailProvider.sendEmail).toHaveBeenCalled();
      // Anti-enumeration: identical response for known and unknown emails.
      expect(result).toEqual(GENERIC_RESPONSE);
    });

    test('silently skips sending for a disabled user (generic response, no email)', async () => {
      const email = 'disabled@example.com';

      mockValidateEmail.mockReturnValue(email);
      mockUsersFindOne.mockResolvedValue(
        createMockUser({ emails: [{ address: email, verified: true }], status: 'disabled' })
      );

      const result = await handleSendMagicLink({ email }, createContext());

      expect(mockTokensInsertOne).not.toHaveBeenCalled();
      expect(mockEmailProvider.sendEmail).not.toHaveBeenCalled();
      expect(result).toEqual(GENERIC_RESPONSE);
    });

    test('throws when email provider is not configured', async () => {
      const email = 'user@example.com';

      mockValidateEmail.mockReturnValue(email);
      mockGetEmailConfig.mockReturnValue({ provider: null });

      await expect(handleSendMagicLink({ email }, createContext())).rejects.toThrow(
        'Email provider is not configured'
      );
    });

    test('rejects disposable email addresses', async () => {
      const email = 'user@disposable.example';

      mockValidateEmail.mockReturnValue(email);
      mockIsDisposableEmail.mockResolvedValue(true as never);

      await expect(handleSendMagicLink({ email }, createContext())).rejects.toThrow(
        'Please use a permanent email address'
      );

      expect(mockTokensInsertOne).not.toHaveBeenCalled();
      expect(mockEmailProvider.sendEmail).not.toHaveBeenCalled();
    });

    test('throws (no email sent) when no base URL can be resolved', async () => {
      const email = 'user@example.com';

      mockGetConfig.mockReturnValue(undefined); // no _system.site.url
      mockValidateEmail.mockReturnValue(email);
      mockUsersFindOne.mockResolvedValue(null);
      mockRandomBytes.mockReturnValue({ toString: () => 'tok' });

      await expect(
        // connectionInfo.baseUrl also absent
        handleSendMagicLink({ email }, createContext({ connectionInfo: {} }))
      ).rejects.toThrow(/site\.url|MODELENCE_SITE_URL/);

      // A broken link must never be emailed.
      expect(mockEmailProvider.sendEmail).not.toHaveBeenCalled();
      // The misconfiguration is caught before the token is generated, so no
      // orphaned (unsendable) token doc is left behind.
      expect(mockTokensInsertOne).not.toHaveBeenCalled();
    });

    test('uses connection info baseUrl as fallback', async () => {
      const email = 'user@example.com';
      const rawToken = 'fallbacktoken';

      mockGetConfig.mockReturnValue(undefined); // no _system.site.url
      mockValidateEmail.mockReturnValue(email);
      mockUsersFindOne.mockResolvedValue(null);
      mockRandomBytes.mockReturnValue({ toString: () => rawToken });

      await handleSendMagicLink(
        { email },
        createContext({ connectionInfo: { baseUrl: 'https://connection.com' } })
      );

      expect(mockEmailProvider.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          html: expect.stringContaining(
            `https://connection.com/api/_internal/auth/magic-link?token=${rawToken}`
          ),
        })
      );
    });

    test('uses custom email template when provided', async () => {
      const email = 'user@example.com';
      const rawToken = 'customtoken';
      type TemplateProps = { email: string; magicLinkUrl: string; code: string; name: string };
      // Custom templates receive both credentials and can render either or both.
      const customTemplate = ({ email: templateEmail, magicLinkUrl, code }: TemplateProps) =>
        `<p>Custom: ${templateEmail} - ${magicLinkUrl} - ${code}</p>`;

      mockValidateEmail.mockReturnValue(email);
      mockGetEmailConfig.mockReturnValue({
        provider: mockEmailProvider,
        from: 'test@example.com',
        magicLink: {
          subject: 'Your sign-in link',
          template: customTemplate,
          redirectUrl: '/auth/magic-link',
        },
      });
      mockUsersFindOne.mockResolvedValue(null);
      mockRandomBytes.mockReturnValue({ toString: () => rawToken });

      await handleSendMagicLink({ email }, createContext());

      expect(mockEmailProvider.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          html: `<p>Custom: ${email} - https://example.com/api/_internal/auth/magic-link?token=${rawToken} - 482193</p>`,
        })
      );
    });

    test('sets token expiry to 15 minutes from now', async () => {
      const email = 'user@example.com';
      const fifteenMinutesMs = 900000;

      mockValidateEmail.mockReturnValue(email);
      mockUsersFindOne.mockResolvedValue(null);
      mockRandomBytes.mockReturnValue({ toString: () => 'token' });

      await handleSendMagicLink({ email }, createContext());

      const call = mockTokensInsertOne.mock.calls[0]?.[0] as {
        expiresAt: Date;
        createdAt: Date;
      };
      expect(call.expiresAt.getTime() - call.createdAt.getTime()).toBe(fifteenMinutesMs);
    });
  });

  describe('handleMagicLinkLanding', () => {
    const makeParams = (token: string | undefined, cookie = vi.fn()) => ({
      query: token === undefined ? {} : { token },
      res: { cookie },
      req: { protocol: 'https', get: () => 'app.example.com' },
    });

    // The catch logs the real cause server-side; silence it in these tests.
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    afterEach(() => consoleErrorSpy.mockClear());
    afterAll(() => consoleErrorSpy.mockRestore());

    test('sets an httpOnly cookie and redirects to the tokenless SPA page when valid', async () => {
      const token = 'valid-landing-token';
      mockTokensFindOne.mockResolvedValue(
        createMockToken({ token, expiresAt: new Date(Date.now() + 1e6) })
      );

      const cookie = vi.fn();
      const result = await handleMagicLinkLanding(makeParams(token, cookie) as never);

      // Lookup is keyed by the hashed token.
      expect(mockTokensFindOne).toHaveBeenCalledWith({ token: sha256(token) });
      expect(cookie).toHaveBeenCalledWith(
        'magicLinkToken',
        token,
        expect.objectContaining({
          httpOnly: true,
          sameSite: 'lax',
          path: '/api/_internal/',
        })
      );
      // No token in the redirect target — it lives only in the cookie.
      expect(result).toEqual({
        status: 302,
        headers: { 'Referrer-Policy': 'no-referrer' },
        redirect: 'https://example.com/auth/magic-link',
      });
      expect(result?.redirect).not.toContain(token);
      // The token must NOT be consumed by the GET: email scanners prefetch
      // links, and the single-use claim happens in the login mutation.
      expect(mockTokensFindOneAndDelete).not.toHaveBeenCalled();
    });

    const FRIENDLY_MESSAGE = 'This sign-in link is invalid or has expired.';
    const friendlyParam = `message=${encodeURIComponent(FRIENDLY_MESSAGE)}`;

    test('redirects with the friendly error and sets no cookie when the token is invalid', async () => {
      mockTokensFindOne.mockResolvedValue(null);

      const cookie = vi.fn();
      const result = await handleMagicLinkLanding(makeParams('bad-token', cookie) as never);

      expect(cookie).not.toHaveBeenCalled();
      expect(result?.status).toBe(302);
      expect(result?.redirect).toContain('status=error');
      expect(result?.redirect).toContain(friendlyParam);
      expect(result?.redirect).not.toContain('bad-token');
    });

    test('redirects with the friendly error when the token is expired', async () => {
      mockTokensFindOne.mockResolvedValue(
        createMockToken({ token: 'expired', expiresAt: new Date(Date.now() - 1000) })
      );

      const cookie = vi.fn();
      const result = await handleMagicLinkLanding(makeParams('expired', cookie) as never);

      expect(cookie).not.toHaveBeenCalled();
      expect(result?.redirect).toContain('status=error');
      expect(result?.redirect).toContain(friendlyParam);
    });

    test('redirects with the friendly error (not a ZodError) when the token is missing', async () => {
      const cookie = vi.fn();
      const result = await handleMagicLinkLanding(makeParams(undefined, cookie) as never);

      expect(cookie).not.toHaveBeenCalled();
      expect(result?.redirect).toContain('status=error');
      expect(result?.redirect).toContain(friendlyParam);
      expect(result?.redirect).not.toContain('invalid_type');
    });
  });

  describe('handleLoginWithMagicLink', () => {
    test('throws when the session is not initialized', async () => {
      const { context } = createLoginContext({ cookieToken: 'token' });
      (context as { session: null }).session = null;

      await expect(handleLoginWithMagicLink({}, context)).rejects.toThrow(
        'Session is not initialized'
      );
    });

    test('throws when magic link auth is not enabled', async () => {
      mockGetAuthConfig.mockReturnValue({});
      const { context } = createLoginContext({ cookieToken: 'token' });

      await expect(handleLoginWithMagicLink({}, context)).rejects.toThrow(
        'Magic link authentication is not enabled'
      );
    });

    test('throws when the cookie is missing', async () => {
      const { context } = createLoginContext();

      await expect(handleLoginWithMagicLink({}, context)).rejects.toThrow();

      expect(mockTokensFindOne).not.toHaveBeenCalled();
    });

    test('throws and clears the cookie when the token is not found', async () => {
      mockTokensFindOne.mockResolvedValue(null);
      const { context, clearCookie } = createLoginContext({ cookieToken: 'unknown-token' });

      await expect(handleLoginWithMagicLink({}, context)).rejects.toThrow(
        'Invalid or expired magic link'
      );

      expect(mockTokensFindOne).toHaveBeenCalledWith({ token: sha256('unknown-token') });
      expect(clearCookie).toHaveBeenCalledWith('magicLinkToken', {
        httpOnly: true,
        secure: false,
        sameSite: 'lax',
        path: '/api/_internal/',
      });
      expect(mockSetSessionUser).not.toHaveBeenCalled();
    });

    test('deletes the token and throws when it is expired', async () => {
      const expiredDoc = createMockToken({ expiresAt: new Date(Date.now() - 1000) });
      mockTokensFindOne.mockResolvedValue(expiredDoc);
      mockTokensFindOneAndDelete.mockResolvedValue(expiredDoc);
      const { context, clearCookie } = createLoginContext({ cookieToken: 'expired-token' });

      await expect(handleLoginWithMagicLink({}, context)).rejects.toThrow('Magic link has expired');

      expect(mockTokensFindOneAndDelete).toHaveBeenCalledWith({ _id: expiredDoc!._id });
      expect(clearCookie).toHaveBeenCalled();
      expect(mockSetSessionUser).not.toHaveBeenCalled();
    });

    describe('existing user (login branch)', () => {
      test('logs in an existing user, marks the email verified, and consumes the token', async () => {
        const email = 'user@example.com';
        const userId = new ObjectId();
        const onAfterLogin = vi.fn();
        mockGetAuthConfig.mockReturnValue({ magicLink: { enabled: true }, onAfterLogin });

        const tokenDoc = createMockToken({ email });
        mockTokensFindOne.mockResolvedValue(tokenDoc);
        mockTokensFindOneAndDelete.mockResolvedValue(tokenDoc);
        const userDoc = createMockUser({
          _id: userId,
          emails: [{ address: email, verified: true }],
          authMethods: { password: { hash: 'hash' } },
        });
        mockUsersFindOne.mockResolvedValue(userDoc);

        const session = createSession();
        const { context, clearCookie } = createLoginContext({ cookieToken: 'raw-token', session });

        const result = await handleLoginWithMagicLink({}, context);

        // Single-use claim by _id at the commit point.
        expect(mockTokensFindOneAndDelete).toHaveBeenCalledWith({ _id: tokenDoc!._id });
        // Clicking the link proves address ownership.
        expect(mockUsersUpdateOne).toHaveBeenCalledWith(
          { _id: userId, 'emails.address': email },
          { $set: { 'emails.$.verified': true } }
        );
        expect(mockSetSessionUser).toHaveBeenCalledWith(session.authToken, userId);
        expect(mockSetAuthTokenCookie).toHaveBeenCalledWith(context.res, session.authToken);
        expect(onAfterLogin).toHaveBeenCalledWith(
          expect.objectContaining({ provider: 'magicLink', user: userDoc, session })
        );
        expect(clearCookie).toHaveBeenCalled();
        expect(result).toEqual({
          user: { id: userId, handle: 'testuser' },
          session: { authToken: session.authToken },
        });
        // No account creation on the login branch.
        expect(mockUsersInsertOne).not.toHaveBeenCalled();
      });

      test('fires onAfterEmailVerification only when the email was unverified', async () => {
        const email = 'user@example.com';
        const onAfterEmailVerification = vi.fn();
        mockGetAuthConfig.mockReturnValue({
          magicLink: { enabled: true },
          onAfterEmailVerification,
        });

        const tokenDoc = createMockToken({ email });
        mockTokensFindOne.mockResolvedValue(tokenDoc);
        mockTokensFindOneAndDelete.mockResolvedValue(tokenDoc);
        mockUsersFindOne.mockResolvedValue(
          createMockUser({ emails: [{ address: email, verified: false }] })
        );

        const { context } = createLoginContext({ cookieToken: 'raw-token' });
        await handleLoginWithMagicLink({}, context);

        expect(onAfterEmailVerification).toHaveBeenCalledWith(
          expect.objectContaining({ provider: 'magicLink' })
        );
      });

      test('does not fire onAfterEmailVerification when the email was already verified', async () => {
        const email = 'user@example.com';
        const onAfterEmailVerification = vi.fn();
        mockGetAuthConfig.mockReturnValue({
          magicLink: { enabled: true },
          onAfterEmailVerification,
        });

        const tokenDoc = createMockToken({ email });
        mockTokensFindOne.mockResolvedValue(tokenDoc);
        mockTokensFindOneAndDelete.mockResolvedValue(tokenDoc);
        mockUsersFindOne.mockResolvedValue(
          createMockUser({ emails: [{ address: email, verified: true }] })
        );

        const { context } = createLoginContext({ cookieToken: 'raw-token' });
        await handleLoginWithMagicLink({}, context);

        expect(onAfterEmailVerification).not.toHaveBeenCalled();
      });

      test('rejects disabled users, burns the token, and fires onLoginError', async () => {
        const email = 'disabled@example.com';
        const onLoginError = vi.fn();
        mockGetAuthConfig.mockReturnValue({ magicLink: { enabled: true }, onLoginError });

        const tokenDoc = createMockToken({ email });
        mockTokensFindOne.mockResolvedValue(tokenDoc);
        mockTokensFindOneAndDelete.mockResolvedValue(tokenDoc);
        mockUsersFindOne.mockResolvedValue(
          createMockUser({ emails: [{ address: email, verified: true }], status: 'disabled' })
        );

        const { context, clearCookie } = createLoginContext({ cookieToken: 'raw-token' });

        await expect(handleLoginWithMagicLink({}, context)).rejects.toThrow(
          'User account is not active'
        );

        expect(mockTokensFindOneAndDelete).toHaveBeenCalledWith({ _id: tokenDoc!._id });
        expect(clearCookie).toHaveBeenCalled();
        expect(mockSetSessionUser).not.toHaveBeenCalled();
        expect(onLoginError).toHaveBeenCalledWith(
          expect.objectContaining({ provider: 'magicLink', error: expect.any(Error) })
        );
      });

      test('aborts without logging in when the token was already claimed (double-spend)', async () => {
        const email = 'user@example.com';
        const tokenDoc = createMockToken({ email });
        mockTokensFindOne.mockResolvedValue(tokenDoc);
        mockTokensFindOneAndDelete.mockResolvedValue(null); // lost the race
        mockUsersFindOne.mockResolvedValue(
          createMockUser({ emails: [{ address: email, verified: true }] })
        );

        const { context } = createLoginContext({ cookieToken: 'raw-token' });

        await expect(handleLoginWithMagicLink({}, context)).rejects.toThrow(
          'Invalid or expired magic link'
        );

        expect(mockSetSessionUser).not.toHaveBeenCalled();
        expect(mockUsersUpdateOne).not.toHaveBeenCalled();
      });
    });

    describe('unknown email (signup branch)', () => {
      const email = 'newuser@example.com';

      const setupSignup = () => {
        const userId = new ObjectId();
        const tokenDoc = createMockToken({ email });
        mockTokensFindOne.mockResolvedValue(tokenDoc);
        mockTokensFindOneAndDelete.mockResolvedValue(tokenDoc);
        // First lookup (by email) finds nothing; second (by insertedId) returns the new user.
        const newUser = createMockUser({
          _id: userId,
          handle: 'newuser',
          emails: [{ address: email, verified: true }],
          authMethods: {},
        });
        mockUsersFindOne.mockResolvedValueOnce(null).mockResolvedValueOnce(newUser);
        mockUsersInsertOne.mockResolvedValue({ insertedId: userId } as never);
        mockResolveUniqueHandle.mockResolvedValue('newuser' as never);
        return { userId, tokenDoc, newUser };
      };

      test('creates the account with a verified email and no authMethods entry', async () => {
        const onBeforeSignup = vi.fn();
        const onAfterSignup = vi.fn();
        mockGetAuthConfig.mockReturnValue({
          magicLink: { enabled: true, allowSignup: true },
          onBeforeSignup,
          onAfterSignup,
        });
        const { userId, tokenDoc, newUser } = setupSignup();

        const session = createSession();
        const { context, clearCookie } = createLoginContext({
          cookieToken: 'raw-token',
          session,
          connectionInfo: { ip: '127.0.0.1' },
        });

        const result = await handleLoginWithMagicLink({}, context);

        expect(onBeforeSignup).toHaveBeenCalledWith(
          expect.objectContaining({ email, provider: 'magicLink' })
        );
        // Successful-signup rate limit bucket is consumed.
        expect(mockConsumeRateLimit).toHaveBeenCalledWith({
          bucket: 'signup',
          type: 'ip',
          value: '127.0.0.1',
        });
        // Token claimed BEFORE the insert so a double-submit cannot create two accounts.
        const claimOrder = mockTokensFindOneAndDelete.mock.invocationCallOrder[0];
        const insertOrder = mockUsersInsertOne.mock.invocationCallOrder[0];
        expect(claimOrder).toBeLessThan(insertOrder);
        expect(mockTokensFindOneAndDelete).toHaveBeenCalledWith({ _id: tokenDoc!._id });
        expect(mockUsersInsertOne).toHaveBeenCalledWith({
          handle: 'newuser',
          status: 'active',
          emails: [{ address: email, verified: true }],
          createdAt: expect.any(Date),
          authMethods: {},
        });
        expect(mockSetSessionUser).toHaveBeenCalledWith(session.authToken, userId);
        expect(onAfterSignup).toHaveBeenCalledWith(
          expect.objectContaining({ provider: 'magicLink', user: newUser, session })
        );
        expect(clearCookie).toHaveBeenCalled();
        expect(result).toEqual({
          user: { id: userId, handle: 'newuser' },
          session: { authToken: session.authToken },
        });
      });

      test('uses the generateHandle hook when configured', async () => {
        const generateHandle = vi.fn().mockResolvedValue('custom-handle');
        mockGetAuthConfig.mockReturnValue({
          magicLink: { enabled: true, allowSignup: true },
          generateHandle,
        });
        setupSignup();

        const { context } = createLoginContext({ cookieToken: 'raw-token' });
        await handleLoginWithMagicLink({}, context);

        expect(generateHandle).toHaveBeenCalledWith({ email });
        expect(mockResolveUniqueHandle).toHaveBeenCalledWith('custom-handle', email, {
          throwOnConflict: false,
        });
      });

      test('rejects the signup when allowSignup is not enabled and fires onSignupError', async () => {
        const onBeforeSignup = vi.fn();
        const onSignupError = vi.fn();
        mockGetAuthConfig.mockReturnValue({
          magicLink: { enabled: true },
          onBeforeSignup,
          onSignupError,
        });

        const tokenDoc = createMockToken({ email });
        mockTokensFindOne.mockResolvedValue(tokenDoc);
        mockUsersFindOne.mockResolvedValue(null);

        const { context, clearCookie } = createLoginContext({ cookieToken: 'raw-token' });

        await expect(handleLoginWithMagicLink({}, context)).rejects.toThrow(
          'Sign up with magic link is not enabled'
        );

        // Rejected before any signup work: no hooks-driven side effects, no
        // account, and the token is not consumed.
        expect(onBeforeSignup).not.toHaveBeenCalled();
        expect(mockUsersInsertOne).not.toHaveBeenCalled();
        expect(mockTokensFindOneAndDelete).not.toHaveBeenCalled();
        expect(mockSetSessionUser).not.toHaveBeenCalled();
        expect(clearCookie).toHaveBeenCalled();
        expect(onSignupError).toHaveBeenCalledWith(
          expect.objectContaining({ provider: 'magicLink', error: expect.any(Error) })
        );
      });

      test('a throwing onBeforeSignup aborts before any account is created and fires onSignupError', async () => {
        const onBeforeSignup = vi.fn().mockRejectedValue(new Error('Domain not allowed'));
        const onSignupError = vi.fn();
        mockGetAuthConfig.mockReturnValue({
          magicLink: { enabled: true, allowSignup: true },
          onBeforeSignup,
          onSignupError,
        });

        const tokenDoc = createMockToken({ email });
        mockTokensFindOne.mockResolvedValue(tokenDoc);
        mockUsersFindOne.mockResolvedValue(null);

        const { context } = createLoginContext({ cookieToken: 'raw-token' });

        await expect(handleLoginWithMagicLink({}, context)).rejects.toThrow('Domain not allowed');

        expect(mockUsersInsertOne).not.toHaveBeenCalled();
        // Token not consumed — the (real) user can retry after fixing the issue.
        expect(mockTokensFindOneAndDelete).not.toHaveBeenCalled();
        expect(mockSetSessionUser).not.toHaveBeenCalled();
        expect(onSignupError).toHaveBeenCalledWith(
          expect.objectContaining({ provider: 'magicLink', error: expect.any(Error) })
        );
      });

      test('aborts without creating an account when the token was already claimed', async () => {
        mockGetAuthConfig.mockReturnValue({ magicLink: { enabled: true, allowSignup: true } });
        const tokenDoc = createMockToken({ email });
        mockTokensFindOne.mockResolvedValue(tokenDoc);
        mockTokensFindOneAndDelete.mockResolvedValue(null); // lost the race
        mockUsersFindOne.mockResolvedValue(null);
        mockResolveUniqueHandle.mockResolvedValue('newuser' as never);

        const { context } = createLoginContext({ cookieToken: 'raw-token' });

        await expect(handleLoginWithMagicLink({}, context)).rejects.toThrow(
          'Invalid or expired magic link'
        );

        expect(mockUsersInsertOne).not.toHaveBeenCalled();
        expect(mockSetSessionUser).not.toHaveBeenCalled();
      });

      const makeDuplicateError = () => {
        const dupError = new MongoServerError({ message: 'E11000 duplicate key' });
        dupError.code = 11000;
        dupError.keyPattern = { 'emails.address': 1 };
        return dupError;
      };

      test('recovers via the LOGIN path (not signup) when a concurrent request created the account first', async () => {
        const onAfterSignup = vi.fn();
        const onAfterLogin = vi.fn();
        mockGetAuthConfig.mockReturnValue({
          magicLink: { enabled: true, allowSignup: true },
          onAfterSignup,
          onAfterLogin,
        });

        const userId = new ObjectId();
        const tokenDoc = createMockToken({ email });
        mockTokensFindOne.mockResolvedValue(tokenDoc);
        mockTokensFindOneAndDelete.mockResolvedValue(tokenDoc);
        mockResolveUniqueHandle.mockResolvedValue('newuser' as never);

        // The account the concurrent winner just created (already verified).
        const winnerUser = createMockUser({
          _id: userId,
          handle: 'newuser',
          emails: [{ address: email, verified: true }],
          authMethods: {},
        });
        // First findOne (initial by-email lookup) → nothing; after the duplicate
        // insert, the recovery re-fetch by email returns the winner's account.
        mockUsersFindOne.mockResolvedValueOnce(null).mockResolvedValueOnce(winnerUser);
        mockUsersInsertOne.mockRejectedValue(makeDuplicateError());

        const session = createSession();
        const { context } = createLoginContext({ cookieToken: 'raw-token', session });

        const result = await handleLoginWithMagicLink({}, context);

        // Logged in, not signed up: session bound, login hook fired, signup hook NOT.
        expect(mockSetSessionUser).toHaveBeenCalledWith(session.authToken, userId);
        expect(onAfterLogin).toHaveBeenCalledWith(
          expect.objectContaining({ provider: 'magicLink', user: winnerUser, session })
        );
        expect(onAfterSignup).not.toHaveBeenCalled();
        expect(result).toEqual({
          user: { id: userId, handle: 'newuser' },
          session: { authToken: session.authToken },
        });
      });

      test('recovery verifies the email and fires onAfterEmailVerification when the winner was an unverified password signup', async () => {
        const onAfterEmailVerification = vi.fn();
        const onAfterLogin = vi.fn();
        mockGetAuthConfig.mockReturnValue({
          magicLink: { enabled: true, allowSignup: true },
          onAfterEmailVerification,
          onAfterLogin,
        });

        const userId = new ObjectId();
        const tokenDoc = createMockToken({ email });
        mockTokensFindOne.mockResolvedValue(tokenDoc);
        mockTokensFindOneAndDelete.mockResolvedValue(tokenDoc);
        mockResolveUniqueHandle.mockResolvedValue('newuser' as never);

        // A concurrent PASSWORD signup created the account as UNVERIFIED.
        const winnerUser = createMockUser({
          _id: userId,
          handle: 'newuser',
          emails: [{ address: email, verified: false }],
          authMethods: { password: { hash: 'x' } },
        });
        mockUsersFindOne.mockResolvedValueOnce(null).mockResolvedValueOnce(winnerUser);
        mockUsersInsertOne.mockRejectedValue(makeDuplicateError());

        const { context } = createLoginContext({ cookieToken: 'raw-token' });

        await handleLoginWithMagicLink({}, context);

        // The magic link proves ownership → the email is marked verified...
        expect(mockUsersUpdateOne).toHaveBeenCalledWith(
          { _id: userId, 'emails.address': email },
          { $set: { 'emails.$.verified': true } }
        );
        // ...and the verification hook fires (it would not on the signup tail).
        expect(onAfterEmailVerification).toHaveBeenCalledWith(
          expect.objectContaining({ provider: 'magicLink', user: winnerUser })
        );
        expect(onAfterLogin).toHaveBeenCalled();
      });

      test('recovery rejects when the winning account is disabled', async () => {
        mockGetAuthConfig.mockReturnValue({ magicLink: { enabled: true, allowSignup: true } });

        const userId = new ObjectId();
        const tokenDoc = createMockToken({ email });
        mockTokensFindOne.mockResolvedValue(tokenDoc);
        mockTokensFindOneAndDelete.mockResolvedValue(tokenDoc);
        mockResolveUniqueHandle.mockResolvedValue('newuser' as never);

        const disabledWinner = createMockUser({
          _id: userId,
          handle: 'newuser',
          status: 'disabled',
          emails: [{ address: email, verified: true }],
          authMethods: {},
        });
        mockUsersFindOne.mockResolvedValueOnce(null).mockResolvedValueOnce(disabledWinner);
        mockUsersInsertOne.mockRejectedValue(makeDuplicateError());

        const { context } = createLoginContext({ cookieToken: 'raw-token' });

        await expect(handleLoginWithMagicLink({}, context)).rejects.toThrow(
          'User account is not active'
        );
        expect(mockSetSessionUser).not.toHaveBeenCalled();
      });

      test('rethrows a non-duplicate insert error and restores the claimed token', async () => {
        mockGetAuthConfig.mockReturnValue({ magicLink: { enabled: true, allowSignup: true } });
        const tokenDoc = createMockToken({ email });
        mockTokensFindOne.mockResolvedValue(tokenDoc);
        mockTokensFindOneAndDelete.mockResolvedValue(tokenDoc);
        mockResolveUniqueHandle.mockResolvedValue('newuser' as never);
        mockUsersFindOne.mockResolvedValue(null);
        mockUsersInsertOne.mockRejectedValue(new Error('disk full'));

        const { context } = createLoginContext({ cookieToken: 'raw-token' });

        await expect(handleLoginWithMagicLink({}, context)).rejects.toThrow('disk full');
        expect(mockSetSessionUser).not.toHaveBeenCalled();
        // No account was created, so the single-use token must not stay
        // burned — the claimed doc is re-inserted and the link works on retry.
        expect(mockTokensInsertOne).toHaveBeenCalledWith(tokenDoc);
      });

      test('restores the claimed token when a concurrent handle collision fails the insert', async () => {
        mockGetAuthConfig.mockReturnValue({ magicLink: { enabled: true, allowSignup: true } });
        const tokenDoc = createMockToken({ email });
        mockTokensFindOne.mockResolvedValue(tokenDoc);
        mockTokensFindOneAndDelete.mockResolvedValue(tokenDoc);
        mockResolveUniqueHandle.mockResolvedValue('newuser' as never);
        mockUsersFindOne.mockResolvedValue(null);

        // Duplicate key on `handle`, not on the email — must NOT trigger the
        // login recovery, and must not burn the token.
        const handleCollision = new MongoServerError({ message: 'E11000 duplicate key' });
        handleCollision.code = 11000;
        handleCollision.keyPattern = { handle: 1 };
        mockUsersInsertOne.mockRejectedValue(handleCollision);

        const { context } = createLoginContext({ cookieToken: 'raw-token' });

        await expect(handleLoginWithMagicLink({}, context)).rejects.toThrow();
        expect(mockSetSessionUser).not.toHaveBeenCalled();
        expect(mockTokensInsertOne).toHaveBeenCalledWith(tokenDoc);
      });

      test('a failing token restore does not mask the original insert error', async () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        mockGetAuthConfig.mockReturnValue({ magicLink: { enabled: true, allowSignup: true } });
        const tokenDoc = createMockToken({ email });
        mockTokensFindOne.mockResolvedValue(tokenDoc);
        mockTokensFindOneAndDelete.mockResolvedValue(tokenDoc);
        mockResolveUniqueHandle.mockResolvedValue('newuser' as never);
        mockUsersFindOne.mockResolvedValue(null);
        mockUsersInsertOne.mockRejectedValue(new Error('disk full'));
        mockTokensInsertOne.mockRejectedValue(new Error('db down'));

        const { context } = createLoginContext({ cookieToken: 'raw-token' });

        await expect(handleLoginWithMagicLink({}, context)).rejects.toThrow('disk full');
        expect(consoleError).toHaveBeenCalled();

        consoleError.mockRestore();
      });
    });
  });

  describe('handleLoginWithOneTimeCode', () => {
    const email = 'user@example.com';
    const CODE = '482193';

    const codeContext = (connectionInfo: Context['connectionInfo'] = {}) => {
      const session = createSession();
      return {
        session,
        context: createContext({ session, connectionInfo }),
      };
    };

    beforeEach(() => {
      mockValidateEmail.mockReturnValue(email);
    });

    test('throws when magic link auth is not enabled', async () => {
      mockGetAuthConfig.mockReturnValue({});
      const { context } = codeContext();

      await expect(handleLoginWithOneTimeCode({ email, code: CODE }, context)).rejects.toThrow(
        'Magic link authentication is not enabled'
      );
    });

    test('checks rate limits (ip and email) before looking up the code', async () => {
      const ip = '127.0.0.1';
      const tokenDoc = createMockToken({ email });
      mockTokensFindOne.mockResolvedValue(tokenDoc);
      mockTokensFindOneAndDelete.mockResolvedValue(tokenDoc);
      mockUsersFindOne.mockResolvedValue(
        createMockUser({ emails: [{ address: email, verified: true }] })
      );
      const { context } = codeContext({ ip });

      await handleLoginWithOneTimeCode({ email, code: CODE }, context);

      expect(mockConsumeRateLimit).toHaveBeenCalledWith({
        bucket: 'oneTimeCode',
        type: 'ip',
        value: ip,
      });
      expect(mockConsumeRateLimit).toHaveBeenCalledWith({
        bucket: 'oneTimeCode',
        type: 'email',
        value: email,
      });
    });

    test('logs in an existing user with a valid code and consumes the doc', async () => {
      const userId = new ObjectId();
      const onAfterLogin = vi.fn();
      mockGetAuthConfig.mockReturnValue({ magicLink: { enabled: true }, onAfterLogin });

      const tokenDoc = createMockToken({ email });
      mockTokensFindOne.mockResolvedValue(tokenDoc);
      mockTokensFindOneAndDelete.mockResolvedValue(tokenDoc);
      mockUsersFindOne.mockResolvedValue(
        createMockUser({ _id: userId, emails: [{ address: email, verified: true }] })
      );

      const { context, session } = codeContext();
      const result = await handleLoginWithOneTimeCode({ email, code: CODE }, context);

      // Lookup is keyed by email + hashed code and excludes capped docs.
      expect(mockTokensFindOne).toHaveBeenCalledWith({
        email,
        code: sha256(CODE),
        attempts: { $lt: 5 },
      });
      expect(mockTokensFindOneAndDelete).toHaveBeenCalledWith({ _id: tokenDoc!._id });
      expect(mockSetSessionUser).toHaveBeenCalledWith(session.authToken, userId);
      expect(onAfterLogin).toHaveBeenCalledWith(expect.objectContaining({ provider: 'magicLink' }));
      expect(result).toEqual({
        user: { id: userId, handle: 'testuser' },
        session: { authToken: session.authToken },
      });
    });

    test('normalizes whitespace and dashes in the typed code', async () => {
      const tokenDoc = createMockToken({ email });
      mockTokensFindOne.mockResolvedValue(tokenDoc);
      mockTokensFindOneAndDelete.mockResolvedValue(tokenDoc);
      mockUsersFindOne.mockResolvedValue(
        createMockUser({ emails: [{ address: email, verified: true }] })
      );

      const { context } = codeContext();
      await handleLoginWithOneTimeCode({ email, code: ' 482 - 193 ' }, context);

      expect(mockTokensFindOne).toHaveBeenCalledWith(
        expect.objectContaining({ code: sha256(CODE) })
      );
    });

    test('counts a wrong guess against all outstanding codes and throws generically', async () => {
      mockTokensFindOne.mockResolvedValue(null);

      const { context } = codeContext();
      await expect(handleLoginWithOneTimeCode({ email, code: '000000' }, context)).rejects.toThrow(
        'Invalid or expired code'
      );

      expect(mockTokensUpdateMany).toHaveBeenCalledWith({ email }, { $inc: { attempts: 1 } });
      expect(mockTokensFindOneAndDelete).not.toHaveBeenCalled();
      expect(mockSetSessionUser).not.toHaveBeenCalled();
    });

    test('throws the same generic error for an unknown email (no enumeration)', async () => {
      mockTokensFindOne.mockResolvedValue(null);

      const { context } = codeContext();
      await expect(handleLoginWithOneTimeCode({ email, code: CODE }, context)).rejects.toThrow(
        'Invalid or expired code'
      );
    });

    test('deletes the doc and throws when the code is expired', async () => {
      const expiredDoc = createMockToken({ email, expiresAt: new Date(Date.now() - 1000) });
      mockTokensFindOne.mockResolvedValue(expiredDoc);
      mockTokensFindOneAndDelete.mockResolvedValue(expiredDoc);

      const { context } = codeContext();
      await expect(handleLoginWithOneTimeCode({ email, code: CODE }, context)).rejects.toThrow(
        'Code has expired'
      );

      expect(mockTokensFindOneAndDelete).toHaveBeenCalledWith({ _id: expiredDoc!._id });
      expect(mockSetSessionUser).not.toHaveBeenCalled();
    });

    test('rejects an unknown email when allowSignup is not enabled', async () => {
      mockGetAuthConfig.mockReturnValue({ magicLink: { enabled: true } });
      const tokenDoc = createMockToken({ email });
      mockTokensFindOne.mockResolvedValue(tokenDoc);
      mockUsersFindOne.mockResolvedValue(null);

      const { context } = codeContext();

      await expect(handleLoginWithOneTimeCode({ email, code: CODE }, context)).rejects.toThrow(
        'Sign up with magic link is not enabled'
      );
      expect(mockUsersInsertOne).not.toHaveBeenCalled();
      expect(mockSetSessionUser).not.toHaveBeenCalled();
    });

    test('creates an account when the email is unknown (signup branch)', async () => {
      const userId = new ObjectId();
      const onAfterSignup = vi.fn();
      mockGetAuthConfig.mockReturnValue({
        magicLink: { enabled: true, allowSignup: true },
        onAfterSignup,
      });

      const tokenDoc = createMockToken({ email });
      mockTokensFindOne.mockResolvedValue(tokenDoc);
      mockTokensFindOneAndDelete.mockResolvedValue(tokenDoc);
      const newUser = createMockUser({
        _id: userId,
        handle: 'user',
        emails: [{ address: email, verified: true }],
        authMethods: {},
      });
      mockUsersFindOne.mockResolvedValueOnce(null).mockResolvedValueOnce(newUser);
      mockUsersInsertOne.mockResolvedValue({ insertedId: userId } as never);
      mockResolveUniqueHandle.mockResolvedValue('user' as never);

      const { context, session } = codeContext();
      const result = await handleLoginWithOneTimeCode({ email, code: CODE }, context);

      expect(mockUsersInsertOne).toHaveBeenCalledWith({
        handle: 'user',
        status: 'active',
        emails: [{ address: email, verified: true }],
        createdAt: expect.any(Date),
        authMethods: {},
      });
      expect(onAfterSignup).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'magicLink', user: newUser })
      );
      expect(result).toEqual({
        user: { id: userId, handle: 'user' },
        session: { authToken: session.authToken },
      });
    });
  });
});
