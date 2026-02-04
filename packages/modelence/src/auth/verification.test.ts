import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { ObjectId } from 'mongodb';

const mockUsersFindOne = jest.fn();
const mockUsersUpdateOne = jest.fn();
const mockTokensFindOne = jest.fn();
const mockTokensInsertOne = jest.fn();
const mockTokensDeleteOne = jest.fn();
const mockGetEmailConfig = jest.fn();
const mockRandomBytes = jest.fn();
const mockTimeHours = jest.fn();
const mockHtmlToText = jest.fn<(html: string) => string>();
const mockTemplate =
  jest.fn<(args: { name?: string; email: string; verificationUrl: string }) => string>();
const mockGetAuthConfig = jest.fn();
const mockValidateEmail = jest.fn<(value: string) => string>();
const mockConsumeRateLimit = jest.fn();

jest.unstable_mockModule('./db', () => ({
  usersCollection: {
    findOne: mockUsersFindOne,
    updateOne: mockUsersUpdateOne,
  },
  emailVerificationTokensCollection: {
    findOne: mockTokensFindOne,
    insertOne: mockTokensInsertOne,
    deleteOne: mockTokensDeleteOne,
  },
}));

jest.unstable_mockModule('@/app/emailConfig', () => ({
  getEmailConfig: mockGetEmailConfig,
}));

jest.unstable_mockModule('crypto', () => ({
  randomBytes: mockRandomBytes,
}));

jest.unstable_mockModule('@/time', () => ({
  time: {
    hours: mockTimeHours,
  },
}));

jest.unstable_mockModule('@/utils', () => ({
  htmlToText: mockHtmlToText,
}));

jest.unstable_mockModule('./templates/emailVerficationTemplate', () => ({
  emailVerificationTemplate: mockTemplate,
}));

jest.unstable_mockModule('@/app/authConfig', () => ({
  getAuthConfig: mockGetAuthConfig,
}));

jest.unstable_mockModule('./validators', () => ({
  validateEmail: mockValidateEmail,
}));

jest.unstable_mockModule('@/rate-limit/rules', () => ({
  consumeRateLimit: mockConsumeRateLimit,
}));

const verificationModule = await import('./verification');
const { handleVerifyEmail, sendVerificationEmail, handleResendEmailVerification } =
  verificationModule;

describe('auth/verification', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockValidateEmail.mockImplementation((value) => value);
    mockGetEmailConfig.mockReturnValue({
      provider: { sendEmail: jest.fn() },
      from: 'no-reply@example.com',
      emailVerifiedRedirectUrl: '/verified',
      verification: {
        subject: 'Verify your email',
        template: null,
      },
    });
    mockGetAuthConfig.mockReturnValue({
      onAfterEmailVerification: jest.fn(),
      onEmailVerificationError: jest.fn(),
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
  });

  describe('handleVerifyEmail', () => {
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
    };
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    afterEach(() => {
      consoleErrorSpy.mockClear();
    });

    afterAll(() => {
      consoleErrorSpy.mockRestore();
    });

    test('verifies email and deletes token when valid', async () => {
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
        onAfterEmailVerification: jest.fn(),
        onEmailVerificationError: jest.fn(),
      };
      mockGetAuthConfig.mockReturnValue(authConfig);
      mockTokensFindOne.mockResolvedValue(tokenDoc as never);
      mockUsersFindOne
        .mockResolvedValueOnce({ _id: 'user123' } as never)
        .mockResolvedValueOnce(userDoc as never);
      mockUsersUpdateOne.mockResolvedValue({ matchedCount: 1 } as never);

      const result = await handleVerifyEmail(baseParams as never);

      expect(mockTokensFindOne).toHaveBeenCalledWith({
        token: 'token',
        expiresAt: { $gt: expect.any(Date) },
      });
      expect(mockUsersFindOne).toHaveBeenCalledWith({ _id: tokenDoc.userId });
      expect(mockUsersUpdateOne).toHaveBeenCalledWith(
        {
          _id: tokenDoc.userId,
          'emails.address': tokenDoc.email,
          'emails.verified': { $ne: true },
        },
        { $set: { 'emails.$.verified': true } }
      );
      expect(mockTokensDeleteOne).toHaveBeenCalledWith({ _id: tokenDoc._id });
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
      expect(result).toEqual({
        status: 301,
        redirect: '/verified?status=verified',
      });
    });

    test('redirects with error when token is invalid', async () => {
      const authConfig = {
        onAfterEmailVerification: jest.fn(),
        onEmailVerificationError: jest.fn(),
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
        status: 301,
        redirect: '/verified?status=error&message=Invalid%20or%20expired%20verification%20token',
      });
    });

    test('redirects with error when user not found', async () => {
      const authConfig = {
        onAfterEmailVerification: jest.fn(),
        onEmailVerificationError: jest.fn(),
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
        status: 301,
        redirect: '/verified?status=error&message=User%20not%20found',
      });
    });
  });

  describe('sendVerificationEmail', () => {
    test('stores token and sends email using default template', async () => {
      const provider = { sendEmail: jest.fn() };
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
          token: 'token123',
          expiresAt: expect.any(Date),
        })
      );
      expect(mockTemplate).toHaveBeenCalled();
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
      expect(result).toEqual({
        success: true,
        message:
          'If that email is registered and not yet verified, a verification email has been sent',
      });
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

      const provider = { sendEmail: jest.fn() };
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
        type: 'user',
        value: userId.toString(),
        message: 'Please wait at least 60 seconds before requesting another verification email',
      });
      expect(mockTokensInsertOne).toHaveBeenCalledWith(
        expect.objectContaining({
          userId,
          email: 'user@example.com',
          token: 'token123',
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
