import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { Response } from 'express';
import { ObjectId } from 'mongodb';

const mockUsersFindOne = vi.fn();
const mockUsersUpdateOne = vi.fn();
const mockFindOneAndUpdate = vi.fn();
const mockTokensFindOne = vi.fn();
const mockTokensInsertOne = vi.fn();
const mockTokensDeleteOne = vi.fn();
const mockTokensUpdateOne = vi.fn();
const mockGetEmailConfig = vi.fn();
const mockRandomBytes = vi.fn();
const mockTimeHours = vi.fn();
const mockHtmlToText = vi.fn<(html: string) => string>();
const mockTemplate =
  vi.fn<(args: { name?: string; email: string; verificationUrl: string }) => string>();
const mockGetAuthConfig = vi.fn();
const mockValidateEmail = vi.fn<(value: string) => string>();
const mockConsumeRateLimit = vi.fn();

vi.doMock('./db', () => ({
  usersCollection: {
    findOne: mockUsersFindOne,
    updateOne: mockUsersUpdateOne,
    findOneAndUpdate: mockFindOneAndUpdate,
  },
  emailVerificationTokensCollection: {
    findOne: mockTokensFindOne,
    insertOne: mockTokensInsertOne,
    deleteOne: mockTokensDeleteOne,
    updateOne: mockTokensUpdateOne,
  },
}));

vi.doMock('./tokenHash', () => ({
  hashToken: (raw: string) => `hashed:${raw}`,
}));

vi.doMock('@/app/emailConfig', () => ({
  getEmailConfig: mockGetEmailConfig,
}));

vi.doMock('crypto', () => ({
  randomBytes: mockRandomBytes,
}));

const mockTimeMinutes = vi.fn();
vi.doMock('@/time', () => ({
  time: {
    hours: mockTimeHours,
    minutes: mockTimeMinutes,
  },
}));

vi.doMock('@/utils', () => ({
  htmlToText: mockHtmlToText,
}));

vi.doMock('./templates/emailVerficationTemplate', () => ({
  emailVerificationTemplate: mockTemplate,
}));

vi.doMock('@/app/authConfig', () => ({
  getAuthConfig: mockGetAuthConfig,
}));

vi.doMock('./validators', () => ({
  validateEmail: mockValidateEmail,
  validateHandle: vi.fn((v: string) => v),
  MAX_HANDLE_LENGTH: 50,
  MIN_HANDLE_LENGTH: 3,
}));

vi.doMock('@/rate-limit/rules', () => ({
  consumeRateLimit: mockConsumeRateLimit,
}));

const mockGetConfig = vi.fn();
vi.doMock('@/config/server', () => ({
  getConfig: mockGetConfig,
}));

const mockCreateSession = vi.fn();
vi.doMock('./session', () => ({
  createSession: mockCreateSession,
  setAuthTokenCookie: vi.fn((res: Response, authToken: string) => {
    res.cookie('authToken', authToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
    });
  }),
}));

const verificationModule = await import('./verification');
const { handleVerifyEmail, sendVerificationEmail, handleResendEmailVerification } =
  verificationModule;

describe('auth/verification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTokensFindOne.mockReset();
    mockUsersFindOne.mockReset();
    mockValidateEmail.mockImplementation((value) => value);
    mockGetEmailConfig.mockReturnValue({
      provider: { sendEmail: vi.fn() },
      from: 'no-reply@example.com',
      emailVerifiedRedirectUrl: '/verified',
      verification: {
        subject: 'Verify your email',
        template: null,
      },
    });
    mockGetAuthConfig.mockReturnValue({
      onAfterEmailVerification: vi.fn(),
      onEmailVerificationError: vi.fn(),
    });
    mockHtmlToText.mockImplementation((html: string) => html);
    mockTemplate.mockImplementation(
      ({ email, verificationUrl }: { email: string; verificationUrl: string }) =>
        `<p>${email} ${verificationUrl}</p>`
    );
    mockRandomBytes.mockReturnValue({
      toString: () => 'token123',
    });
    mockTimeHours.mockReturnValue(24 * 60 * 60 * 1000);
    mockTimeMinutes.mockImplementation((n: unknown) => (n as number) * 60 * 1000);
  });

  describe('handleVerifyEmail', () => {
    const mockCookie = vi.fn();
    const baseParams = {
      query: { token: 'token' },
      headers: {
        'user-agent': 'test-agent',
        'accept-language': 'en-US',
        referer: 'https://example.com/signup',
      },
      req: {
        ip: '192.168.1.1',
        socket: { remoteAddress: '192.168.1.1' },
      },
      res: { cookie: mockCookie },
    };
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    afterEach(() => {
      consoleErrorSpy.mockClear();
    });

    afterAll(() => {
      consoleErrorSpy.mockRestore();
    });

    test('verifies email and marks the token used, without signing the user in', async () => {
      const tokenDoc = {
        _id: 'token-id',
        token: 'token',
        userId: 'user123',
        email: 'user@example.com',
        expiresAt: new Date(Date.now() + 1000),
      };
      const userDoc = {
        _id: 'user123',
        emails: [{ address: 'user@example.com', verified: true }],
      };
      const authConfig = {
        onAfterEmailVerification: vi.fn(),
        onEmailVerificationError: vi.fn(),
      };
      mockGetAuthConfig.mockReturnValue(authConfig);
      mockTokensFindOne.mockResolvedValue(tokenDoc as never);
      mockUsersFindOne.mockResolvedValueOnce({ _id: 'user123' } as never);
      mockFindOneAndUpdate.mockResolvedValue(userDoc as never);
      const result = await handleVerifyEmail(baseParams as never);

      expect(mockTokensFindOne).toHaveBeenCalledTimes(1);
      expect(mockTokensFindOne).toHaveBeenCalledWith({
        token: 'hashed:token',
        expiresAt: { $gt: expect.any(Date) },
      });
      expect(mockUsersFindOne).toHaveBeenCalledWith({
        _id: tokenDoc.userId,
        status: { $nin: ['deleted', 'disabled'] },
      });
      expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
        {
          _id: tokenDoc.userId,
          status: { $nin: ['deleted', 'disabled'] },
          emails: { $elemMatch: { address: tokenDoc.email, verified: { $ne: true } } },
        },
        { $set: { 'emails.$.verified': true } },
        { collation: { locale: 'en', strength: 2 }, returnDocument: 'after' }
      );
      expect(mockTokensUpdateOne).toHaveBeenCalledWith(
        { _id: tokenDoc._id },
        { $set: { usedAt: expect.any(Date) } }
      );
      expect(mockTokensDeleteOne).not.toHaveBeenCalled();
      expect(authConfig.onAfterEmailVerification).toHaveBeenCalledWith({
        provider: 'email',
        user: userDoc,
        session: null,
        connectionInfo: {
          baseUrl: undefined,
          ip: '192.168.1.1',
          userAgent: 'test-agent',
          acceptLanguage: 'en-US',
          referrer: 'https://example.com/signup',
        },
      });
      // Opening the link must not sign anyone in: mail scanners open links
      // before the user does, and a forwarded link would hand out a session.
      expect(mockCreateSession).not.toHaveBeenCalled();
      expect(mockCookie).not.toHaveBeenCalled();
      expect(result).toEqual({
        status: 302,
        headers: { 'Referrer-Policy': 'no-referrer' },
        redirect: '/verified?status=verified',
      });
    });

    test('verifies a second address on an account that already has a verified one', async () => {
      // The reported repro: account holds a verified address A plus an
      // unverified B. The old filter's independent `'emails.verified': { $ne:
      // true }` meant "no element is verified", so B could never be verified.
      const tokenDoc = {
        _id: 'token-id',
        token: 'token',
        userId: 'user123',
        email: 'b@example.com',
        expiresAt: new Date(Date.now() + 1000),
      };
      mockTokensFindOne.mockResolvedValue(tokenDoc as never);
      mockUsersFindOne.mockResolvedValueOnce({
        _id: 'user123',
        emails: [
          { address: 'a@example.com', verified: true },
          { address: 'b@example.com', verified: false },
        ],
      } as never);
      mockFindOneAndUpdate.mockResolvedValue({
        _id: 'user123',
        emails: [
          { address: 'a@example.com', verified: true },
          { address: 'b@example.com', verified: true },
        ],
      } as never);

      const result = await handleVerifyEmail(baseParams as never);

      // The selector must scope both conditions to the single element carrying
      // the address, so the already-verified A cannot block B.
      expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          emails: { $elemMatch: { address: 'b@example.com', verified: { $ne: true } } },
        }),
        { $set: { 'emails.$.verified': true } },
        { collation: { locale: 'en', strength: 2 }, returnDocument: 'after' }
      );
      expect(result).toEqual({
        status: 302,
        headers: { 'Referrer-Policy': 'no-referrer' },
        redirect: '/verified?status=verified',
      });
    });

    test('reports verified when the address was already verified before the open', async () => {
      // A concurrent open (e.g. a mail scanner) verified the address after this
      // one read the token unused but before it read the user. Same outcome as
      // a second verification email for an already-verified address.
      const authConfig = {
        onAfterEmailVerification: vi.fn(),
        onEmailVerificationError: vi.fn(),
      };
      mockGetAuthConfig.mockReturnValue(authConfig);
      const tokenDoc = {
        _id: 'token-id',
        token: 'token',
        userId: 'user123',
        email: 'b@example.com',
        expiresAt: new Date(Date.now() + 1000),
      };
      mockTokensFindOne.mockResolvedValue(tokenDoc as never);
      mockUsersFindOne.mockResolvedValueOnce({
        _id: 'user123',
        emails: [
          { address: 'a@example.com', verified: true },
          { address: 'b@example.com', verified: true },
        ],
      } as never);
      mockFindOneAndUpdate.mockResolvedValue(null as never);

      const result = await handleVerifyEmail(baseParams as never);

      expect(result).toEqual({
        status: 302,
        headers: { 'Referrer-Policy': 'no-referrer' },
        redirect: '/verified?status=verified',
      });
      // The open that verified the address fires the hook; this one must not.
      expect(authConfig.onAfterEmailVerification).not.toHaveBeenCalled();
      expect(authConfig.onEmailVerificationError).not.toHaveBeenCalled();
      expect(mockTokensUpdateOne).toHaveBeenCalledWith(
        { _id: tokenDoc._id },
        { $set: { usedAt: expect.any(Date) } }
      );
    });

    test('does not claim already-verified when the address is still unverified', async () => {
      // Previously the fallback only matched on address, so a failed update on
      // an unverified address was misreported as "Email is already verified".
      const tokenDoc = {
        _id: 'token-id',
        token: 'token',
        userId: 'user123',
        email: 'b@example.com',
        expiresAt: new Date(Date.now() + 1000),
      };
      mockTokensFindOne.mockResolvedValue(tokenDoc as never);
      mockUsersFindOne.mockResolvedValue({
        _id: 'user123',
        emails: [{ address: 'b@example.com', verified: false }],
      } as never);
      mockFindOneAndUpdate.mockResolvedValue(null as never);

      const result = await handleVerifyEmail(baseParams as never);

      expect(result).toEqual({
        status: 302,
        headers: { 'Referrer-Policy': 'no-referrer' },
        redirect: '/verified?status=error&message=Unable%20to%20verify%20email%20address',
      });
    });

    test('reports verified when a concurrent open verified the address first', async () => {
      // A mail scanner and the user open the link at once: both read the token
      // unused, but only one update can match. The other must not show an error.
      const authConfig = {
        onAfterEmailVerification: vi.fn(),
        onEmailVerificationError: vi.fn(),
      };
      mockGetAuthConfig.mockReturnValue(authConfig);
      mockTokensFindOne.mockResolvedValue({
        _id: 'token-id',
        token: 'hashed:token',
        hashed: true,
        userId: 'user123',
        email: 'b@example.com',
        expiresAt: new Date(Date.now() + 1000),
      } as never);
      mockUsersFindOne
        .mockResolvedValueOnce({
          _id: 'user123',
          emails: [{ address: 'b@example.com', verified: false }],
        } as never)
        .mockResolvedValueOnce({
          _id: 'user123',
          emails: [{ address: 'b@example.com', verified: true }],
        } as never);
      mockFindOneAndUpdate.mockResolvedValue(null as never);

      const result = await handleVerifyEmail(baseParams as never);

      expect(result?.redirect).toBe('/verified?status=verified');
      // The open that verified the address fires the hook; this one must not.
      expect(authConfig.onAfterEmailVerification).not.toHaveBeenCalled();
      expect(authConfig.onEmailVerificationError).not.toHaveBeenCalled();
    });

    test('reports a missing address when the user does not hold it', async () => {
      const tokenDoc = {
        _id: 'token-id',
        token: 'token',
        userId: 'user123',
        email: 'ghost@example.com',
        expiresAt: new Date(Date.now() + 1000),
      };
      mockTokensFindOne.mockResolvedValue(tokenDoc as never);
      mockUsersFindOne.mockResolvedValueOnce({
        _id: 'user123',
        emails: [{ address: 'a@example.com', verified: true }],
      } as never);
      mockFindOneAndUpdate.mockResolvedValue(null as never);

      const result = await handleVerifyEmail(baseParams as never);

      expect(result).toEqual({
        status: 302,
        headers: { 'Referrer-Policy': 'no-referrer' },
        redirect:
          '/verified?status=error&message=Email%20address%20not%20found%20for%20this%20user',
      });
    });

    test('consumes the token even when the update matches nothing', async () => {
      // A token that always fails must not stay spendable until its 24h expiry.
      const tokenDoc = {
        _id: 'token-id',
        token: 'token',
        userId: 'user123',
        email: 'b@example.com',
        expiresAt: new Date(Date.now() + 1000),
      };
      mockTokensFindOne.mockResolvedValue(tokenDoc as never);
      mockUsersFindOne.mockResolvedValueOnce({
        _id: 'user123',
        emails: [{ address: 'b@example.com', verified: true }],
      } as never);
      mockFindOneAndUpdate.mockResolvedValue(null as never);

      await handleVerifyEmail(baseParams as never);

      expect(mockTokensUpdateOne).toHaveBeenCalledWith(
        { _id: tokenDoc._id },
        { $set: { usedAt: expect.any(Date) } }
      );
    });

    test('still accepts a link sent before tokens were hashed', async () => {
      const legacyTokenDoc = {
        _id: 'token-id',
        token: 'token',
        userId: 'user123',
        email: 'user@example.com',
        expiresAt: new Date(Date.now() + 1000),
      };
      mockTokensFindOne.mockResolvedValueOnce(null).mockResolvedValueOnce(legacyTokenDoc as never);
      mockUsersFindOne.mockResolvedValueOnce({ _id: 'user123' } as never);
      mockFindOneAndUpdate.mockResolvedValue({
        _id: 'user123',
        emails: [{ address: 'user@example.com', verified: true }],
      } as never);

      const result = await handleVerifyEmail(baseParams as never);

      // Raw tokens and their hashes are both 64 hex chars, so the fallback is
      // limited to unmarked docs: a hash copied from the db must not match.
      expect(mockTokensFindOne).toHaveBeenLastCalledWith({
        token: 'token',
        hashed: { $ne: true },
        expiresAt: { $gt: expect.any(Date) },
      });
      expect(result?.redirect).toBe('/verified?status=verified');
    });

    test('reports verified when a used link is opened again', async () => {
      // A mail scanner opened the link first; the user's own click must not error.
      const authConfig = {
        onAfterEmailVerification: vi.fn(),
        onEmailVerificationError: vi.fn(),
      };
      mockGetAuthConfig.mockReturnValue(authConfig);
      mockTokensFindOne.mockResolvedValue({
        _id: 'token-id',
        token: 'hashed:token',
        hashed: true,
        userId: 'user123',
        email: 'user@example.com',
        usedAt: new Date(),
        expiresAt: new Date(Date.now() + 1000),
      } as never);
      mockUsersFindOne.mockResolvedValueOnce({
        _id: 'user123',
        emails: [{ address: 'User@Example.com', verified: true }],
      } as never);

      const result = await handleVerifyEmail(baseParams as never);

      expect(result).toEqual({
        status: 302,
        headers: { 'Referrer-Policy': 'no-referrer' },
        redirect: '/verified?status=verified',
      });
      expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
      expect(mockTokensUpdateOne).not.toHaveBeenCalled();
      expect(authConfig.onAfterEmailVerification).not.toHaveBeenCalled();
      expect(authConfig.onEmailVerificationError).not.toHaveBeenCalled();
      expect(mockCreateSession).not.toHaveBeenCalled();
    });

    test('rejects a used link when its address is no longer verified', async () => {
      mockTokensFindOne.mockResolvedValue({
        _id: 'token-id',
        token: 'hashed:token',
        hashed: true,
        userId: 'user123',
        email: 'user@example.com',
        usedAt: new Date(),
        expiresAt: new Date(Date.now() + 1000),
      } as never);
      mockUsersFindOne.mockResolvedValueOnce({
        _id: 'user123',
        emails: [{ address: 'user@example.com', verified: false }],
      } as never);

      const result = await handleVerifyEmail(baseParams as never);

      expect(result?.redirect).toBe(
        '/verified?status=error&message=Invalid%20or%20expired%20verification%20token'
      );
      expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
    });

    test('redirects with error when token is invalid', async () => {
      const authConfig = {
        onAfterEmailVerification: vi.fn(),
        onEmailVerificationError: vi.fn(),
      };
      mockGetAuthConfig.mockReturnValue(authConfig);
      mockTokensFindOne.mockResolvedValue(null as never);

      const result = await handleVerifyEmail(baseParams as never);

      expect(authConfig.onEmailVerificationError).toHaveBeenCalledWith({
        provider: 'email',
        error: expect.any(Error),
        session: null,
        connectionInfo: {
          baseUrl: undefined,
          ip: '192.168.1.1',
          userAgent: 'test-agent',
          acceptLanguage: 'en-US',
          referrer: 'https://example.com/signup',
        },
      });
      expect(result).toEqual({
        status: 302,
        headers: { 'Referrer-Policy': 'no-referrer' },
        redirect: '/verified?status=error&message=Invalid%20or%20expired%20verification%20token',
      });
    });

    test('appends status to a redirect URL that already has a query string', async () => {
      mockGetEmailConfig.mockReturnValue({
        provider: { sendEmail: vi.fn() },
        emailVerifiedRedirectUrl: 'https://app.example.com/welcome?source=email',
      });
      mockTokensFindOne.mockResolvedValue(null as never);

      const result = await handleVerifyEmail(baseParams as never);

      expect(result?.redirect).toBe(
        'https://app.example.com/welcome?source=email&status=error&message=Invalid%20or%20expired%20verification%20token'
      );
    });

    test('redirects with error when user not found', async () => {
      const authConfig = {
        onAfterEmailVerification: vi.fn(),
        onEmailVerificationError: vi.fn(),
      };
      mockGetAuthConfig.mockReturnValue(authConfig);
      const tokenDoc = {
        _id: 'token-id',
        token: 'token',
        userId: 'user123',
        email: 'user@example.com',
        expiresAt: new Date(Date.now() + 1000),
      };
      mockTokensFindOne.mockResolvedValue(tokenDoc as never);
      mockUsersFindOne.mockResolvedValue(null as never);

      const result = await handleVerifyEmail(baseParams as never);

      expect(authConfig.onEmailVerificationError).toHaveBeenCalledWith({
        provider: 'email',
        error: expect.any(Error),
        session: null,
        connectionInfo: {
          baseUrl: undefined,
          ip: '192.168.1.1',
          userAgent: 'test-agent',
          acceptLanguage: 'en-US',
          referrer: 'https://example.com/signup',
        },
      });
      expect(result).toEqual({
        status: 302,
        headers: { 'Referrer-Policy': 'no-referrer' },
        redirect: '/verified?status=error&message=User%20not%20found',
      });
    });
  });

  describe('sendVerificationEmail', () => {
    test('stores token and sends email using default template', async () => {
      const provider = { sendEmail: vi.fn() };
      mockGetEmailConfig.mockReturnValue({
        provider,
        from: 'support@example.com',
        verification: {},
      });

      await sendVerificationEmail({
        userId: 'user123' as never,
        email: 'user@example.com',
        baseUrl: 'https://example.com',
      });

      expect(mockRandomBytes).toHaveBeenCalledWith(32);
      expect(mockTokensInsertOne).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user123',
          email: 'user@example.com',
          token: 'hashed:token123',
          hashed: true,
          expiresAt: expect.any(Date),
        })
      );
      // The raw token goes only into the emailed link.
      expect(mockTemplate).toHaveBeenCalledWith(
        expect.objectContaining({
          verificationUrl: 'https://example.com/api/_internal/auth/verify-email?token=token123',
        })
      );
      expect(provider.sendEmail).toHaveBeenCalledWith({
        to: 'user@example.com',
        from: 'support@example.com',
        subject: 'Verify your email address',
        text: expect.any(String),
        html: expect.any(String),
      });
    });

    test('skips sending when provider not configured', async () => {
      mockGetEmailConfig.mockReturnValue({
        provider: null,
      });

      await sendVerificationEmail({
        userId: 'user123' as never,
        email: 'user@example.com',
      });

      expect(mockTokensInsertOne).not.toHaveBeenCalled();
    });

    test('prefers _system.site.url over the request-derived baseUrl', async () => {
      const provider = { sendEmail: vi.fn() };
      mockGetEmailConfig.mockReturnValue({ provider, verification: {} });
      mockGetConfig.mockReturnValue('https://app.example.com');

      await sendVerificationEmail({
        userId: 'user123' as never,
        email: 'user@example.com',
        // Simulates the internal container host seen behind a reverse proxy.
        baseUrl: 'http://10.1.118.6:3000',
      });

      expect(mockTemplate).toHaveBeenCalledWith(
        expect.objectContaining({
          verificationUrl: 'https://app.example.com/api/_internal/auth/verify-email?token=token123',
        })
      );
    });

    test('falls back to the request-derived baseUrl when config is unset', async () => {
      const provider = { sendEmail: vi.fn() };
      mockGetEmailConfig.mockReturnValue({ provider, verification: {} });
      mockGetConfig.mockReturnValue(undefined);

      await sendVerificationEmail({
        userId: 'user123' as never,
        email: 'user@example.com',
        baseUrl: 'https://custom-domain.example.com',
      });

      expect(mockTemplate).toHaveBeenCalledWith(
        expect.objectContaining({
          verificationUrl:
            'https://custom-domain.example.com/api/_internal/auth/verify-email?token=token123',
        })
      );
    });
  });

  describe('handleResendEmailVerification', () => {
    const baseContext = {
      connectionInfo: {
        ip: '203.0.113.10',
        baseUrl: 'https://app.example.com',
      },
    };

    test('returns generic response when email is not found', async () => {
      mockUsersFindOne.mockResolvedValue(null as never);

      const result = await handleResendEmailVerification(
        { email: 'user@example.com' } as never,
        baseContext as never
      );

      expect(mockValidateEmail).toHaveBeenCalledWith('user@example.com');
      expect(mockConsumeRateLimit).toHaveBeenCalledTimes(1);
      expect(mockConsumeRateLimit).toHaveBeenCalledWith({
        bucket: 'verification',
        type: 'ip',
        value: '203.0.113.10',
      });
      expect(result).toEqual({
        success: true,
        message:
          'If that email is registered and not yet verified, a verification email has been sent',
      });
      expect(mockGetEmailConfig).not.toHaveBeenCalled();
    });

    test('returns generic response when email already verified', async () => {
      mockUsersFindOne.mockResolvedValue({
        _id: 'user123',
        emails: [{ address: 'user@example.com', verified: true }],
      } as never);

      const result = await handleResendEmailVerification(
        { email: 'user@example.com' } as never,
        baseContext as never
      );

      expect(mockConsumeRateLimit).toHaveBeenCalledTimes(1);
      expect(mockConsumeRateLimit).toHaveBeenCalledWith(
        expect.objectContaining({ bucket: 'verification', type: 'ip' })
      );
      expect(result).toEqual({
        success: true,
        message:
          'If that email is registered and not yet verified, a verification email has been sent',
      });
    });

    test('rate limits by IP before looking up the user', async () => {
      mockConsumeRateLimit.mockRejectedValueOnce(new Error('Rate limit exceeded') as never);

      await expect(
        handleResendEmailVerification({ email: 'user@example.com' } as never, baseContext as never)
      ).rejects.toThrow('Rate limit exceeded');

      expect(mockConsumeRateLimit).toHaveBeenCalledWith({
        bucket: 'verification',
        type: 'ip',
        value: '203.0.113.10',
      });
      expect(mockUsersFindOne).not.toHaveBeenCalled();
    });

    test('skips the per-IP limit when the client IP is unknown', async () => {
      mockUsersFindOne.mockResolvedValue(null as never);

      await handleResendEmailVerification(
        { email: 'user@example.com' } as never,
        {
          connectionInfo: { baseUrl: 'https://app.example.com' },
        } as never
      );

      expect(mockConsumeRateLimit).not.toHaveBeenCalled();
    });

    test('throws when email provider is missing', async () => {
      mockGetEmailConfig.mockReturnValue({
        provider: null,
      });
      const userId = new ObjectId('64b64b64b64b64b64b64b64b');
      mockUsersFindOne.mockResolvedValue({
        _id: userId,
        emails: [{ address: 'user@example.com', verified: false }],
      } as never);

      await expect(
        handleResendEmailVerification({ email: 'user@example.com' } as never, baseContext as never)
      ).rejects.toThrow('Email provider is not configured');
    });

    test('sends verification email when unverified', async () => {
      const userId = new ObjectId('64b64b64b64b64b64b64b64b');
      mockUsersFindOne.mockResolvedValue({
        _id: userId,
        emails: [{ address: 'user@example.com', verified: false }],
      } as never);

      const provider = { sendEmail: vi.fn() };
      mockGetEmailConfig.mockReturnValue({
        provider,
        from: 'no-reply@example.com',
        verification: {},
      });

      const result = await handleResendEmailVerification(
        { email: 'user@example.com' } as never,
        baseContext as never
      );

      expect(mockConsumeRateLimit).toHaveBeenCalledWith({
        bucket: 'verification',
        type: 'ip',
        value: '203.0.113.10',
      });
      expect(mockConsumeRateLimit).toHaveBeenCalledWith({
        bucket: 'verification',
        type: 'user',
        value: userId.toString(),
        message: 'Please wait at least 60 seconds before requesting another verification email',
      });
      expect(mockTokensInsertOne).toHaveBeenCalledWith(
        expect.objectContaining({
          userId,
          email: 'user@example.com',
          token: 'hashed:token123',
          hashed: true,
          expiresAt: expect.any(Date),
        })
      );
      expect(provider.sendEmail).toHaveBeenCalledWith({
        to: 'user@example.com',
        from: 'no-reply@example.com',
        subject: 'Verify your email address',
        text: expect.any(String),
        html: expect.any(String),
      });
      expect(result).toEqual({
        success: true,
        message:
          'If that email is registered and not yet verified, a verification email has been sent',
      });
    });
  });
});
