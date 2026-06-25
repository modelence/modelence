import { afterAll, afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { MockedFunction } from 'vitest';
import { ObjectId } from 'mongodb';
import { createHash as actualCreateHash } from 'crypto';
import type { Context } from '@/methods/types';
import type { usersCollection, resetPasswordTokensCollection } from './db';

const sha256 = (value: string) => actualCreateHash('sha256').update(value).digest('hex');

type UsersCollection = typeof usersCollection;
type ResetPasswordTokensCollection = typeof resetPasswordTokensCollection;

const mockUsersFindOne: MockedFunction<UsersCollection['findOne']> = vi.fn();
const mockUsersUpdateOne: MockedFunction<UsersCollection['updateOne']> = vi.fn();
const mockResetTokensInsertOne: MockedFunction<ResetPasswordTokensCollection['insertOne']> =
  vi.fn();
const mockResetTokensFindOne: MockedFunction<ResetPasswordTokensCollection['findOne']> = vi.fn();
const mockResetTokensDeleteOne: MockedFunction<ResetPasswordTokensCollection['deleteOne']> =
  vi.fn();
const mockResetTokensFindOneAndDelete: MockedFunction<
  ResetPasswordTokensCollection['findOneAndDelete']
> = vi.fn();
const mockGetEmailConfig = vi.fn();
const mockHtmlToText: MockedFunction<(html: string) => string> = vi.fn();
const mockValidateEmail: MockedFunction<(email: string) => string> = vi.fn();
const mockValidatePassword: MockedFunction<(password: string) => string> = vi.fn();
const mockRandomBytes = vi.fn();
const mockBcryptHash: MockedFunction<(password: string, rounds: number) => Promise<string>> =
  vi.fn();
const mockTime = { hours: vi.fn() };
const mockConsumeRateLimit = vi.fn();
const mockGetConfig = vi.fn();
const mockInvalidateAllUserSessions = vi.fn();

vi.doMock('./session', () => ({
  invalidateAllUserSessions: mockInvalidateAllUserSessions,
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
  },
  resetPasswordTokensCollection: {
    insertOne: mockResetTokensInsertOne,
    findOne: mockResetTokensFindOne,
    deleteOne: mockResetTokensDeleteOne,
    findOneAndDelete: mockResetTokensFindOneAndDelete,
  },
}));

vi.doMock('@/app/emailConfig', () => ({
  getEmailConfig: mockGetEmailConfig,
}));

vi.doMock('@/utils', () => ({
  htmlToText: mockHtmlToText,
}));

vi.doMock('./validators', () => ({
  validateEmail: mockValidateEmail,
  validatePassword: mockValidatePassword,
}));

vi.doMock('crypto', () => ({
  randomBytes: mockRandomBytes,
  // tokenHash.ts (imported transitively) needs the real createHash.
  createHash: actualCreateHash,
}));

vi.doMock('bcrypt', () => ({
  default: {
    hash: mockBcryptHash,
  },
}));

vi.doMock('@/time', () => ({
  time: mockTime,
}));

const resetPasswordModule = await import('./resetPassword');
const { handleSendResetPasswordToken, handleResetPassword, handleResetPasswordLanding } =
  resetPasswordModule;

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
    authMethods: overrides.authMethods ?? { password: { hash: 'hashedpassword' } },
  }) as Awaited<ReturnType<UsersCollection['findOne']>>;

const createMockResetToken = (
  overrides: Partial<{
    _id: ObjectId;
    userId: ObjectId;
    email: string;
    token: string;
    expiresAt: Date;
    createdAt: Date;
  }> = {}
) =>
  ({
    _id: overrides._id ?? new ObjectId(),
    userId: overrides.userId ?? new ObjectId(),
    email: overrides.email ?? 'user@example.com',
    token: overrides.token ?? 'token123',
    expiresAt: overrides.expiresAt ?? new Date(Date.now() + 1000000),
    createdAt: overrides.createdAt ?? new Date(),
  }) as Awaited<ReturnType<ResetPasswordTokensCollection['findOne']>>;

describe('auth/resetPassword', () => {
  const mockEmailProvider = {
    sendEmail: vi.fn(async (_message: unknown) => {}),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetEmailConfig.mockReturnValue({
      provider: mockEmailProvider,
      from: 'test@example.com',
      passwordReset: {
        subject: 'Reset your password',
        redirectUrl: '/reset-password',
      },
    });
    mockConsumeRateLimit.mockResolvedValue(undefined as never);
    mockHtmlToText.mockImplementation((html: string) => html.replace(/<[^>]*>/g, ''));
    mockTime.hours.mockReturnValue(3600000); // 1 hour in ms
    mockGetConfig.mockReturnValue('https://example.com');
  });

  describe('handleSendResetPasswordToken', () => {
    test('checks rate limit before sending email', async () => {
      const email = 'user@example.com';
      const ip = '127.0.0.1';

      mockValidateEmail.mockReturnValue(email);
      mockUsersFindOne.mockResolvedValue(
        createMockUser({
          emails: [{ address: email, verified: true }],
          authMethods: { password: { hash: 'hash' } },
        })
      );
      mockRandomBytes.mockReturnValue({
        toString: () => 'token',
      });

      await handleSendResetPasswordToken(
        { email },
        createContext({ connectionInfo: { baseUrl: 'https://example.com', ip } })
      );

      expect(mockConsumeRateLimit).toHaveBeenCalledWith({
        bucket: 'passwordReset',
        type: 'ip',
        value: ip,
      });
      expect(mockConsumeRateLimit).toHaveBeenCalledWith({
        bucket: 'passwordReset',
        type: 'email',
        value: email,
      });
    });
    test('sends reset email for valid user with password auth', async () => {
      const email = 'user@example.com';
      const userId = new ObjectId();
      const resetToken = 'abc123token';

      mockValidateEmail.mockReturnValue(email);
      mockUsersFindOne.mockResolvedValue(
        createMockUser({
          _id: userId,
          emails: [{ address: email, verified: true }],
          authMethods: { password: { hash: 'hashedpassword' } },
          status: 'active',
        })
      );
      mockRandomBytes.mockReturnValue({
        toString: () => resetToken,
      });

      const result = await handleSendResetPasswordToken(
        { email },
        createContext({ connectionInfo: { baseUrl: 'https://example.com' } })
      );

      expect(mockValidateEmail).toHaveBeenCalledWith(email);
      expect(mockUsersFindOne).toHaveBeenCalledWith(
        { 'emails.address': email, status: { $nin: ['deleted', 'disabled'] } },
        { collation: { locale: 'en', strength: 2 } }
      );
      // Token is stored hashed at rest, never as the raw value.
      expect(mockResetTokensInsertOne).toHaveBeenCalledWith({
        userId,
        email,
        token: sha256(resetToken),
        createdAt: expect.any(Date),
        expiresAt: expect.any(Date),
      });
      // Email links to the server landing route carrying the raw token, not the SPA page.
      expect(mockEmailProvider.sendEmail).toHaveBeenCalledWith({
        to: email,
        from: 'test@example.com',
        subject: 'Reset your password',
        text: expect.any(String),
        html: expect.stringContaining(
          `https://example.com/api/_internal/auth/reset-password?token=${resetToken}`
        ),
      });
      expect(result).toEqual({
        success: true,
        message: 'If an account with that email exists, a password reset link has been sent',
      });
    });

    test('returns success message even if user does not exist', async () => {
      const email = 'nonexistent@example.com';

      mockValidateEmail.mockReturnValue(email);
      mockUsersFindOne.mockResolvedValue(null);

      const result = await handleSendResetPasswordToken(
        { email },
        createContext({ connectionInfo: { baseUrl: 'https://example.com' } })
      );

      expect(mockResetTokensInsertOne).not.toHaveBeenCalled();
      expect(mockEmailProvider.sendEmail).not.toHaveBeenCalled();
      expect(result).toEqual({
        success: true,
        message: 'If an account with that email exists, a password reset link has been sent',
      });
    });

    test('returns success message if user has no password auth method', async () => {
      const email = 'oauth@example.com';

      mockValidateEmail.mockReturnValue(email);
      mockUsersFindOne.mockResolvedValue(
        createMockUser({
          emails: [{ address: email, verified: true }],
          authMethods: { google: { id: '12345' } }, // No password method
          status: 'active',
        })
      );

      const result = await handleSendResetPasswordToken(
        { email },
        createContext({ connectionInfo: { baseUrl: 'https://example.com' } })
      );

      expect(mockResetTokensInsertOne).not.toHaveBeenCalled();
      expect(mockEmailProvider.sendEmail).not.toHaveBeenCalled();
      expect(result).toEqual({
        success: true,
        message: 'If an account with that email exists, a password reset link has been sent',
      });
    });

    test('throws error if email provider is not configured', async () => {
      const email = 'user@example.com';

      mockValidateEmail.mockReturnValue(email);
      mockGetEmailConfig.mockReturnValue({ provider: null });
      mockUsersFindOne.mockResolvedValue(
        createMockUser({
          emails: [{ address: email, verified: true }],
          authMethods: { password: { hash: 'hash' } },
          status: 'active',
        })
      );

      await expect(
        handleSendResetPasswordToken(
          { email },
          createContext({ connectionInfo: { baseUrl: 'https://example.com' } })
        )
      ).rejects.toThrow('Email provider is not configured');
    });

    test('uses default email template if custom template not provided', async () => {
      const email = 'user@example.com';
      const resetToken = 'token123';

      mockValidateEmail.mockReturnValue(email);
      mockGetEmailConfig.mockReturnValue({
        provider: mockEmailProvider,
        from: 'test@example.com',
        passwordReset: {
          subject: 'Reset your password',
          template: undefined,
          redirectUrl: '/reset',
        },
      });
      mockUsersFindOne.mockResolvedValue(
        createMockUser({
          emails: [{ address: email, verified: true }],
          authMethods: { password: { hash: 'hash' } },
          status: 'active',
        })
      );
      mockRandomBytes.mockReturnValue({
        toString: () => resetToken,
      });

      await handleSendResetPasswordToken(
        { email },
        createContext({ connectionInfo: { baseUrl: 'https://example.com' } })
      );

      expect(mockEmailProvider.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          html: expect.stringContaining(email),
        })
      );
    });

    test('uses custom email template if provided', async () => {
      const email = 'user@example.com';
      const resetToken = 'customtoken';
      type TemplateProps = { email: string; resetUrl: string; name: string };
      const customTemplate = ({ email: templateEmail, resetUrl }: TemplateProps) =>
        `<p>Custom: ${templateEmail} - ${resetUrl}</p>`;

      mockValidateEmail.mockReturnValue(email);
      mockGetEmailConfig.mockReturnValue({
        provider: mockEmailProvider,
        from: 'test@example.com',
        passwordReset: {
          subject: 'Reset your password',
          template: customTemplate,
          redirectUrl: '/reset',
        },
      });
      mockUsersFindOne.mockResolvedValue(
        createMockUser({
          emails: [{ address: email, verified: true }],
          authMethods: { password: { hash: 'hash' } },
          status: 'active',
        })
      );
      mockRandomBytes.mockReturnValue({
        toString: () => resetToken,
      });

      await handleSendResetPasswordToken(
        { email },
        createContext({ connectionInfo: { baseUrl: 'https://example.com' } })
      );

      expect(mockEmailProvider.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          html: `<p>Custom: ${email} - https://example.com/api/_internal/auth/reset-password?token=${resetToken}</p>`,
        })
      );
    });

    test('uses MODELENCE_SITE_URL when provided', async () => {
      const email = 'user@example.com';
      const resetToken = 'token456';

      mockGetConfig.mockReturnValue('https://custom.com');

      mockValidateEmail.mockReturnValue(email);
      mockUsersFindOne.mockResolvedValue(
        createMockUser({
          emails: [{ address: email, verified: true }],
          authMethods: { password: { hash: 'hash' } },
          status: 'active',
        })
      );
      mockRandomBytes.mockReturnValue({
        toString: () => resetToken,
      });

      await handleSendResetPasswordToken(
        { email },
        createContext({ connectionInfo: { baseUrl: 'https://fallback.com' } })
      );

      expect(mockEmailProvider.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          html: expect.stringContaining(
            'https://custom.com/api/_internal/auth/reset-password?token='
          ),
        })
      );
    });

    test('uses connection info baseUrl as fallback', async () => {
      const email = 'user@example.com';
      const resetToken = 'token789';

      mockGetConfig.mockReturnValue(undefined);

      mockValidateEmail.mockReturnValue(email);
      mockUsersFindOne.mockResolvedValue(
        createMockUser({
          emails: [{ address: email, verified: true }],
          authMethods: { password: { hash: 'hash' } },
          status: 'active',
        })
      );
      mockRandomBytes.mockReturnValue({
        toString: () => resetToken,
      });

      await handleSendResetPasswordToken(
        { email },
        createContext({ connectionInfo: { baseUrl: 'https://connection.com' } })
      );

      expect(mockEmailProvider.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          html: expect.stringContaining(
            'https://connection.com/api/_internal/auth/reset-password?token='
          ),
        })
      );
    });

    test('throws (no email sent) when no base URL can be resolved', async () => {
      const email = 'user@example.com';

      mockGetConfig.mockReturnValue(undefined); // no _system.site.url
      mockValidateEmail.mockReturnValue(email);
      mockUsersFindOne.mockResolvedValue(
        createMockUser({
          emails: [{ address: email, verified: true }],
          authMethods: { password: { hash: 'hash' } },
          status: 'active',
        })
      );
      mockRandomBytes.mockReturnValue({ toString: () => 'tok' });

      await expect(
        // connectionInfo.baseUrl also absent
        handleSendResetPasswordToken({ email }, createContext({ connectionInfo: {} }))
      ).rejects.toThrow(/site\.url|MODELENCE_SITE_URL/);

      // A broken link must never be emailed.
      expect(mockEmailProvider.sendEmail).not.toHaveBeenCalled();
    });

    test('email always links to the server landing route regardless of redirectUrl', async () => {
      // redirectUrl now configures only the SPA page the landing route redirects
      // to after stashing the token; the email itself always targets the server
      // landing route so the raw token never reaches a client-rendered URL.
      const email = 'user@example.com';
      const resetToken = 'token000';

      mockValidateEmail.mockReturnValue(email);
      mockGetEmailConfig.mockReturnValue({
        provider: mockEmailProvider,
        from: 'test@example.com',
        passwordReset: {
          subject: 'Reset your password',
          redirectUrl: 'https://external.com/custom-reset',
        },
      });
      mockUsersFindOne.mockResolvedValue(
        createMockUser({
          emails: [{ address: email, verified: true }],
          authMethods: { password: { hash: 'hash' } },
          status: 'active',
        })
      );
      mockRandomBytes.mockReturnValue({
        toString: () => resetToken,
      });

      await handleSendResetPasswordToken(
        { email },
        createContext({ connectionInfo: { baseUrl: 'https://example.com' } })
      );

      expect(mockEmailProvider.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          html: expect.stringContaining(
            `https://example.com/api/_internal/auth/reset-password?token=${resetToken}`
          ),
        })
      );
      // The raw external SPA URL must not appear with the token.
      expect(mockEmailProvider.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          html: expect.not.stringContaining('https://external.com/custom-reset?token='),
        })
      );
    });

    test('sets token expiry to 1 hour from now', async () => {
      const email = 'user@example.com';
      const oneHourMs = 3600000;

      mockValidateEmail.mockReturnValue(email);
      mockTime.hours.mockReturnValue(oneHourMs);
      mockUsersFindOne.mockResolvedValue(
        createMockUser({
          emails: [{ address: email, verified: true }],
          authMethods: { password: { hash: 'hash' } },
          status: 'active',
        })
      );
      mockRandomBytes.mockReturnValue({
        toString: () => 'token',
      });

      await handleSendResetPasswordToken(
        { email },
        createContext({ connectionInfo: { baseUrl: 'https://example.com' } })
      );

      expect(mockResetTokensInsertOne).toHaveBeenCalledWith(
        expect.objectContaining({
          expiresAt: expect.any(Date),
        })
      );

      const call = mockResetTokensInsertOne.mock.calls[0]?.[0] as {
        expiresAt: Date;
        createdAt: Date;
      };
      const expiresAt = call.expiresAt.getTime();
      const createdAt = call.createdAt.getTime();
      const diff = expiresAt - createdAt;

      expect(diff).toBe(oneHourMs);
    });
  });

  describe('handleResetPassword', () => {
    test('successfully resets password with valid token', async () => {
      const token = 'validtoken123';
      const password = 'NewP@ssw0rd!';
      const hashedPassword = 'hashedNewPassword';
      const userId = new ObjectId();
      const email = 'user@example.com';

      mockValidatePassword.mockReturnValue(password);
      mockUsersFindOne.mockResolvedValue(
        createMockUser({
          _id: userId,
          emails: [{ address: email, verified: false }],
          authMethods: { password: { hash: 'oldHash' } },
        })
      );
      mockBcryptHash.mockResolvedValue(hashedPassword);

      // Token is found read-only, then claimed atomically by _id at the commit point.
      const tokenDoc = createMockResetToken({
        userId,
        email,
        token,
        expiresAt: new Date(Date.now() + 1000000),
        createdAt: new Date(),
      });
      mockResetTokensFindOne.mockResolvedValue(tokenDoc);
      mockResetTokensFindOneAndDelete.mockResolvedValue(tokenDoc);

      const result = await handleResetPassword({ token, password }, createContext());

      expect(mockValidatePassword).toHaveBeenCalledWith(password);
      // Lookup is keyed by the hashed token; the claim is keyed by _id.
      expect(mockResetTokensFindOne).toHaveBeenCalledWith({ token: sha256(token) });
      expect(mockResetTokensFindOneAndDelete).toHaveBeenCalledWith({ _id: tokenDoc!._id });
      expect(mockUsersFindOne).toHaveBeenCalledWith({ _id: userId });
      expect(mockBcryptHash).toHaveBeenCalledWith(password, 10);
      expect(mockUsersUpdateOne).toHaveBeenNthCalledWith(
        1,
        { _id: userId },
        { $set: { 'authMethods.password.hash': hashedPassword } }
      );
      expect(mockUsersUpdateOne).toHaveBeenNthCalledWith(
        2,
        { _id: userId, 'emails.address': email },
        { $set: { 'emails.$.verified': true } }
      );
      expect(mockInvalidateAllUserSessions).toHaveBeenCalledWith(userId);
      expect(mockResetTokensDeleteOne).not.toHaveBeenCalled();
      expect(result).toEqual({
        success: true,
        message: 'Password has been reset successfully',
      });
    });

    test('skips email verification for legacy tokens without email field', async () => {
      const token = 'legacytoken';
      const password = 'NewP@ssw0rd!';
      const userId = new ObjectId();

      mockValidatePassword.mockReturnValue(password);
      const legacyDoc = {
        _id: new ObjectId(),
        userId,
        token,
        expiresAt: new Date(Date.now() + 1000000),
        createdAt: new Date(),
        // no email field — simulates a legacy token
      };
      mockResetTokensFindOne.mockResolvedValue(legacyDoc as never);
      mockResetTokensFindOneAndDelete.mockResolvedValue(legacyDoc as never);
      mockUsersFindOne.mockResolvedValue(
        createMockUser({ _id: userId, authMethods: { password: { hash: 'oldHash' } } })
      );
      mockBcryptHash.mockResolvedValue('hashedPassword');

      await handleResetPassword({ token, password }, createContext());

      expect(mockUsersUpdateOne).toHaveBeenCalledTimes(1);
      expect(mockUsersUpdateOne).toHaveBeenCalledWith(
        { _id: userId },
        { $set: { 'authMethods.password.hash': 'hashedPassword' } }
      );
      expect(mockInvalidateAllUserSessions).toHaveBeenCalledWith(userId);
    });

    test('throws error if reset token not found', async () => {
      const token = 'invalidtoken';
      const password = 'NewP@ssw0rd!';

      mockValidatePassword.mockReturnValue(password);
      mockResetTokensFindOne.mockResolvedValue(null);

      await expect(handleResetPassword({ token, password }, createContext())).rejects.toThrow(
        'Invalid or expired reset token'
      );

      // Nothing was consumed and the password was never touched.
      expect(mockResetTokensFindOneAndDelete).not.toHaveBeenCalled();
      expect(mockBcryptHash).not.toHaveBeenCalled();
      expect(mockUsersUpdateOne).not.toHaveBeenCalled();
    });

    test('throws error and deletes token if token is expired', async () => {
      const token = 'expiredtoken';
      const password = 'NewP@ssw0rd!';
      const userId = new ObjectId();

      mockValidatePassword.mockReturnValue(password);
      const expiredDoc = createMockResetToken({
        userId,
        token,
        expiresAt: new Date(Date.now() - 1000), // Expired 1 second ago
        createdAt: new Date(Date.now() - 4000000),
      });
      mockResetTokensFindOne.mockResolvedValue(expiredDoc);
      mockResetTokensFindOneAndDelete.mockResolvedValue(expiredDoc);

      await expect(handleResetPassword({ token, password }, createContext())).rejects.toThrow(
        'Reset token has expired'
      );

      // Expired token is removed (claimed by _id) and the password never touched.
      expect(mockResetTokensFindOneAndDelete).toHaveBeenCalledWith({ _id: expiredDoc!._id });
      expect(mockBcryptHash).not.toHaveBeenCalled();
      expect(mockUsersUpdateOne).not.toHaveBeenCalled();
    });

    test('throws error if user not found and does NOT consume the token', async () => {
      const token = 'validtoken';
      const password = 'NewP@ssw0rd!';
      const userId = new ObjectId();

      mockValidatePassword.mockReturnValue(password);
      mockResetTokensFindOne.mockResolvedValue(
        createMockResetToken({
          userId,
          token,
          expiresAt: new Date(Date.now() + 1000000),
          createdAt: new Date(),
        })
      );
      mockUsersFindOne.mockResolvedValue(null);

      await expect(handleResetPassword({ token, password }, createContext())).rejects.toThrow(
        'User not found'
      );

      expect(mockBcryptHash).not.toHaveBeenCalled();
      expect(mockUsersUpdateOne).not.toHaveBeenCalled();
      // The link stays valid so the user can retry — token must NOT be consumed.
      expect(mockResetTokensFindOneAndDelete).not.toHaveBeenCalled();
    });

    test('validates password before resetting', async () => {
      const token = 'validtoken';
      const weakPassword = '123';
      const userId = new ObjectId();

      mockValidatePassword.mockImplementation(() => {
        throw new Error('Password must be at least 8 characters');
      });
      mockResetTokensFindOne.mockResolvedValue(
        createMockResetToken({
          userId,
          token,
          expiresAt: new Date(Date.now() + 1000000),
          createdAt: new Date(),
        })
      );

      await expect(
        handleResetPassword({ token, password: weakPassword }, createContext())
      ).rejects.toThrow('Password must be at least 8 characters');

      expect(mockBcryptHash).not.toHaveBeenCalled();
      expect(mockUsersUpdateOne).not.toHaveBeenCalled();
      // Validation runs before the token is claimed, so the token is left intact.
      expect(mockResetTokensFindOneAndDelete).not.toHaveBeenCalled();
    });

    test('uses bcrypt with salt rounds 10', async () => {
      const token = 'validtoken';
      const password = 'SecureP@ssw0rd';
      const userId = new ObjectId();

      mockValidatePassword.mockReturnValue(password);
      const tokenDoc = createMockResetToken({
        userId,
        token,
        expiresAt: new Date(Date.now() + 1000000),
        createdAt: new Date(),
      });
      mockResetTokensFindOne.mockResolvedValue(tokenDoc);
      mockResetTokensFindOneAndDelete.mockResolvedValue(tokenDoc);
      mockUsersFindOne.mockResolvedValue(
        createMockUser({
          _id: userId,
          emails: [{ address: 'user@example.com', verified: true }],
        })
      );
      mockBcryptHash.mockResolvedValue('hashResult');

      await handleResetPassword({ token, password }, createContext());

      expect(mockBcryptHash).toHaveBeenCalledWith(password, 10);
    });

    test('consumes the reset token atomically by _id (single-use) on success', async () => {
      const token = 'onetimetoken';
      const password = 'NewP@ssw0rd!';
      const userId = new ObjectId();

      mockValidatePassword.mockReturnValue(password);
      const tokenDoc = createMockResetToken({
        userId,
        token,
        expiresAt: new Date(Date.now() + 1000000),
        createdAt: new Date(),
      });
      mockResetTokensFindOne.mockResolvedValue(tokenDoc);
      mockResetTokensFindOneAndDelete.mockResolvedValue(tokenDoc);
      mockUsersFindOne.mockResolvedValue(
        createMockUser({
          _id: userId,
          emails: [{ address: 'user@example.com', verified: true }],
        })
      );
      mockBcryptHash.mockResolvedValue('hashedPassword');

      await handleResetPassword({ token, password }, createContext());

      // Exactly one atomic claim by _id; no separate deleteOne.
      expect(mockResetTokensFindOneAndDelete).toHaveBeenCalledTimes(1);
      expect(mockResetTokensFindOneAndDelete).toHaveBeenCalledWith({ _id: tokenDoc!._id });
      expect(mockResetTokensDeleteOne).not.toHaveBeenCalled();
    });

    test('aborts without changing the password if the token was already claimed', async () => {
      // Simulates a concurrent request that consumed the token between the
      // read and the commit: findOne returns the doc, but the claim returns null.
      const token = 'racedtoken';
      const password = 'NewP@ssw0rd!';
      const userId = new ObjectId();

      mockValidatePassword.mockReturnValue(password);
      mockResetTokensFindOne.mockResolvedValue(
        createMockResetToken({ userId, token, expiresAt: new Date(Date.now() + 1e6) })
      );
      mockUsersFindOne.mockResolvedValue(createMockUser({ _id: userId }));
      mockBcryptHash.mockResolvedValue('hashedPassword');
      mockResetTokensFindOneAndDelete.mockResolvedValue(null); // lost the race

      await expect(handleResetPassword({ token, password }, createContext())).rejects.toThrow(
        'Invalid or expired reset token'
      );

      // Password must not be updated when the claim is lost.
      expect(mockUsersUpdateOne).not.toHaveBeenCalled();
      expect(mockInvalidateAllUserSessions).not.toHaveBeenCalled();
    });

    test('reads the token from the httpOnly cookie when present, ignoring args', async () => {
      const cookieToken = 'cookie-token';
      const password = 'NewP@ssw0rd!';
      const userId = new ObjectId();

      mockValidatePassword.mockReturnValue(password);
      const tokenDoc = createMockResetToken({
        userId,
        token: cookieToken,
        expiresAt: new Date(Date.now() + 1e6),
      });
      mockResetTokensFindOne.mockResolvedValue(tokenDoc);
      mockResetTokensFindOneAndDelete.mockResolvedValue(tokenDoc);
      mockUsersFindOne.mockResolvedValue(createMockUser({ _id: userId }));
      mockBcryptHash.mockResolvedValue('hashedPassword');

      const clearCookie = vi.fn();
      const httpContext = {
        ...createContext(),
        req: { cookies: { resetPasswordToken: cookieToken } },
        res: { clearCookie },
      };

      // args.token is a decoy — the cookie value must win.
      await handleResetPassword({ token: 'decoy-arg-token', password }, httpContext as never);

      expect(mockResetTokensFindOne).toHaveBeenCalledWith({ token: sha256(cookieToken) });
      expect(mockResetTokensFindOne).not.toHaveBeenCalledWith({
        token: sha256('decoy-arg-token'),
      });
      // Cookie is cleared after a successful reset.
      expect(clearCookie).toHaveBeenCalledWith('resetPasswordToken', { path: '/api/_internal/' });
    });

    test('falls back to a legacy plaintext token when no hashed match exists', async () => {
      const token = 'legacy-plaintext-token';
      const password = 'NewP@ssw0rd!';
      const userId = new ObjectId();
      const legacyDoc = createMockResetToken({
        userId,
        token, // stored as plaintext (pre-hashing)
        expiresAt: new Date(Date.now() + 1e6),
      });

      mockValidatePassword.mockReturnValue(password);
      // First lookup (hashed) misses, second (plaintext) hits; claim succeeds.
      mockResetTokensFindOne.mockResolvedValueOnce(null).mockResolvedValueOnce(legacyDoc);
      mockResetTokensFindOneAndDelete.mockResolvedValue(legacyDoc);
      mockUsersFindOne.mockResolvedValue(createMockUser({ _id: userId }));
      mockBcryptHash.mockResolvedValue('hashedPassword');

      const result = await handleResetPassword({ token, password }, createContext());

      expect(mockResetTokensFindOne).toHaveBeenNthCalledWith(1, { token: sha256(token) });
      expect(mockResetTokensFindOne).toHaveBeenNthCalledWith(2, { token });
      // Consumed by _id at the commit point.
      expect(mockResetTokensFindOneAndDelete).toHaveBeenCalledWith({ _id: legacyDoc!._id });
      expect(result).toEqual({ success: true, message: 'Password has been reset successfully' });
    });
  });

  describe('handleResetPasswordLanding', () => {
    const makeParams = (token: string | undefined, cookie = vi.fn()) => ({
      query: token === undefined ? {} : { token },
      res: { cookie },
      req: { protocol: 'https', get: () => 'app.example.com' },
    });

    test('sets an httpOnly cookie and redirects to the tokenless SPA page when valid', async () => {
      mockGetConfig.mockReturnValue('https://example.com');
      mockGetEmailConfig.mockReturnValue({ passwordReset: { redirectUrl: '/new-password' } });
      const token = 'valid-landing-token';
      mockResetTokensFindOne.mockResolvedValue(
        createMockResetToken({ token, expiresAt: new Date(Date.now() + 1e6) })
      );

      const cookie = vi.fn();
      const result = await handleResetPasswordLanding(makeParams(token, cookie) as never);

      expect(cookie).toHaveBeenCalledWith(
        'resetPasswordToken',
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
        redirect: 'https://example.com/new-password',
      });
      expect(result?.redirect).not.toContain(token);
    });

    // The single user-facing message every error case must surface.
    const FRIENDLY_MESSAGE = 'This password reset link is invalid or has expired.';
    const friendlyParam = `message=${encodeURIComponent(FRIENDLY_MESSAGE)}`;

    // The catch logs the real cause server-side; silence it in these tests.
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    afterEach(() => consoleErrorSpy.mockClear());
    afterAll(() => consoleErrorSpy.mockRestore());

    test('redirects with the friendly error and sets no cookie when the token is invalid', async () => {
      mockGetConfig.mockReturnValue('https://example.com');
      mockGetEmailConfig.mockReturnValue({ passwordReset: { redirectUrl: '/new-password' } });
      mockResetTokensFindOne.mockResolvedValue(null);

      const cookie = vi.fn();
      const result = await handleResetPasswordLanding(makeParams('bad-token', cookie) as never);

      expect(cookie).not.toHaveBeenCalled();
      expect(result?.status).toBe(302);
      expect(result?.redirect).toContain('status=error');
      expect(result?.redirect).toContain(friendlyParam);
      expect(result?.redirect).not.toContain('bad-token');
    });

    test('redirects with the friendly error when the token is expired', async () => {
      mockGetConfig.mockReturnValue('https://example.com');
      mockGetEmailConfig.mockReturnValue({ passwordReset: { redirectUrl: '/new-password' } });
      mockResetTokensFindOne.mockResolvedValue(
        createMockResetToken({ token: 'expired', expiresAt: new Date(Date.now() - 1000) })
      );

      const cookie = vi.fn();
      const result = await handleResetPasswordLanding(makeParams('expired', cookie) as never);

      expect(cookie).not.toHaveBeenCalled();
      expect(result?.redirect).toContain('status=error');
      expect(result?.redirect).toContain(friendlyParam);
    });

    test('redirects with the friendly error (not a ZodError) when the token is missing', async () => {
      mockGetConfig.mockReturnValue('https://example.com');
      mockGetEmailConfig.mockReturnValue({ passwordReset: { redirectUrl: '/new-password' } });

      const cookie = vi.fn();
      const result = await handleResetPasswordLanding(makeParams(undefined, cookie) as never);

      expect(cookie).not.toHaveBeenCalled();
      expect(result?.redirect).toContain('status=error');
      // The friendly message — NOT the raw ZodError issues array.
      expect(result?.redirect).toContain(friendlyParam);
      expect(result?.redirect).not.toContain('Required');
      expect(result?.redirect).not.toContain('invalid_type');
    });
  });
});
