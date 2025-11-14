import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { ObjectId } from 'mongodb';
import type { Context } from '@/methods/types';

const mockUsersFindOne = jest.fn();
const mockUsersUpdateOne = jest.fn();
const mockResetTokensInsertOne = jest.fn();
const mockResetTokensFindOne = jest.fn();
const mockResetTokensDeleteOne = jest.fn();
const mockGetEmailConfig = jest.fn();
const mockHtmlToText = jest.fn();
const mockValidateEmail = jest.fn();
const mockValidatePassword = jest.fn();
const mockRandomBytes = jest.fn();
const mockBcryptHash = jest.fn();
const mockTime = { hours: jest.fn() };

jest.unstable_mockModule('./db', () => ({
  usersCollection: {
    findOne: mockUsersFindOne,
    updateOne: mockUsersUpdateOne,
  },
  resetPasswordTokensCollection: {
    insertOne: mockResetTokensInsertOne,
    findOne: mockResetTokensFindOne,
    deleteOne: mockResetTokensDeleteOne,
  },
}));

jest.unstable_mockModule('@/app/emailConfig', () => ({
  getEmailConfig: mockGetEmailConfig,
}));

jest.unstable_mockModule('@/utils', () => ({
  htmlToText: mockHtmlToText,
}));

jest.unstable_mockModule('./validators', () => ({
  validateEmail: mockValidateEmail,
  validatePassword: mockValidatePassword,
}));

jest.unstable_mockModule('crypto', () => ({
  randomBytes: mockRandomBytes,
}));

jest.unstable_mockModule('bcrypt', () => ({
  default: {
    hash: mockBcryptHash,
  },
}));

jest.unstable_mockModule('@/time', () => ({
  time: mockTime,
}));

const { handleSendResetPasswordToken, handleResetPassword } = await import('./resetPassword');

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
});

describe('auth/resetPassword', () => {
  const mockEmailProvider = {
    sendEmail: jest.fn(async (_message: unknown) => {}),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetEmailConfig.mockReturnValue({
      provider: mockEmailProvider,
      from: 'test@example.com',
      passwordReset: {
        subject: 'Reset your password',
        redirectUrl: '/reset-password',
      },
    });
    mockHtmlToText.mockImplementation((html: string) => html.replace(/<[^>]*>/g, ''));
    mockTime.hours.mockReturnValue(3600000); // 1 hour in ms
    process.env.MODELENCE_SITE_URL = 'https://example.com';
  });

  afterEach(() => {
    delete process.env.MODELENCE_SITE_URL;
  });

  describe('handleSendResetPasswordToken', () => {
    test('sends reset email for valid user with password auth', async () => {
      const email = 'user@example.com';
      const userId = new ObjectId();
      const resetToken = 'abc123token';

      mockValidateEmail.mockReturnValue(email);
      mockUsersFindOne.mockResolvedValue({
        _id: userId,
        emails: [{ address: email, verified: true }],
        authMethods: { password: { hash: 'hashedpassword' } },
        status: 'active',
      });
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
      expect(mockResetTokensInsertOne).toHaveBeenCalledWith({
        userId,
        token: resetToken,
        createdAt: expect.any(Date),
        expiresAt: expect.any(Date),
      });
      expect(mockEmailProvider.sendEmail).toHaveBeenCalledWith({
        to: email,
        from: 'test@example.com',
        subject: 'Reset your password',
        text: expect.any(String),
        html: expect.stringContaining(resetToken),
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
      mockUsersFindOne.mockResolvedValue({
        _id: new ObjectId(),
        emails: [{ address: email, verified: true }],
        authMethods: { google: { id: '12345' } }, // No password method
        status: 'active',
      });

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
      mockUsersFindOne.mockResolvedValue({
        _id: new ObjectId(),
        emails: [{ address: email, verified: true }],
        authMethods: { password: { hash: 'hash' } },
        status: 'active',
      });

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
      mockUsersFindOne.mockResolvedValue({
        _id: new ObjectId(),
        emails: [{ address: email, verified: true }],
        authMethods: { password: { hash: 'hash' } },
        status: 'active',
      });
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
      mockUsersFindOne.mockResolvedValue({
        _id: new ObjectId(),
        emails: [{ address: email, verified: true }],
        authMethods: { password: { hash: 'hash' } },
        status: 'active',
      });
      mockRandomBytes.mockReturnValue({
        toString: () => resetToken,
      });

      await handleSendResetPasswordToken(
        { email },
        createContext({ connectionInfo: { baseUrl: 'https://example.com' } })
      );

      expect(mockEmailProvider.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          html: `<p>Custom: ${email} - https://example.com/reset?token=${resetToken}</p>`,
        })
      );
    });

    test('uses MODELENCE_SITE_URL when provided', async () => {
      const email = 'user@example.com';
      const resetToken = 'token456';

      process.env.MODELENCE_SITE_URL = 'https://custom.com';

      mockValidateEmail.mockReturnValue(email);
      mockUsersFindOne.mockResolvedValue({
        _id: new ObjectId(),
        emails: [{ address: email, verified: true }],
        authMethods: { password: { hash: 'hash' } },
        status: 'active',
      });
      mockRandomBytes.mockReturnValue({
        toString: () => resetToken,
      });

      await handleSendResetPasswordToken(
        { email },
        createContext({ connectionInfo: { baseUrl: 'https://fallback.com' } })
      );

      expect(mockEmailProvider.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          html: expect.stringContaining('https://custom.com/reset-password?token='),
        })
      );
    });

    test('uses connection info baseUrl as fallback', async () => {
      const email = 'user@example.com';
      const resetToken = 'token789';

      delete process.env.MODELENCE_SITE_URL;

      mockValidateEmail.mockReturnValue(email);
      mockUsersFindOne.mockResolvedValue({
        _id: new ObjectId(),
        emails: [{ address: email, verified: true }],
        authMethods: { password: { hash: 'hash' } },
        status: 'active',
      });
      mockRandomBytes.mockReturnValue({
        toString: () => resetToken,
      });

      await handleSendResetPasswordToken(
        { email },
        createContext({ connectionInfo: { baseUrl: 'https://connection.com' } })
      );

      expect(mockEmailProvider.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          html: expect.stringContaining('https://connection.com/reset-password?token='),
        })
      );
    });

    test('handles absolute URL in redirectUrl configuration', async () => {
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
      mockUsersFindOne.mockResolvedValue({
        _id: new ObjectId(),
        emails: [{ address: email, verified: true }],
        authMethods: { password: { hash: 'hash' } },
        status: 'active',
      });
      mockRandomBytes.mockReturnValue({
        toString: () => resetToken,
      });

      await handleSendResetPasswordToken(
        { email },
        createContext({ connectionInfo: { baseUrl: 'https://example.com' } })
      );

      expect(mockEmailProvider.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          html: expect.stringContaining('https://external.com/custom-reset?token='),
        })
      );
    });

    test('sets token expiry to 1 hour from now', async () => {
      const email = 'user@example.com';
      const oneHourMs = 3600000;

      mockValidateEmail.mockReturnValue(email);
      mockTime.hours.mockReturnValue(oneHourMs);
      mockUsersFindOne.mockResolvedValue({
        _id: new ObjectId(),
        emails: [{ address: email, verified: true }],
        authMethods: { password: { hash: 'hash' } },
        status: 'active',
      });
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

      const call = mockResetTokensInsertOne.mock.calls[0][0];
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

      mockValidatePassword.mockReturnValue(password);
      mockResetTokensFindOne.mockResolvedValue({
        userId,
        token,
        expiresAt: new Date(Date.now() + 1000000), // Not expired
        createdAt: new Date(),
      });
      mockUsersFindOne.mockResolvedValue({
        _id: userId,
        emails: [{ address: 'user@example.com', verified: true }],
        authMethods: { password: { hash: 'oldHash' } },
      });
      mockBcryptHash.mockResolvedValue(hashedPassword);

      const result = await handleResetPassword({ token, password }, createContext());

      expect(mockValidatePassword).toHaveBeenCalledWith(password);
      expect(mockResetTokensFindOne).toHaveBeenCalledWith({ token });
      expect(mockUsersFindOne).toHaveBeenCalledWith({ _id: userId });
      expect(mockBcryptHash).toHaveBeenCalledWith(password, 10);
      expect(mockUsersUpdateOne).toHaveBeenCalledWith(
        { _id: userId },
        {
          $set: {
            'authMethods.password.hash': hashedPassword,
          },
        }
      );
      expect(mockResetTokensDeleteOne).toHaveBeenCalledWith({ token });
      expect(result).toEqual({
        success: true,
        message: 'Password has been reset successfully',
      });
    });

    test('throws error if reset token not found', async () => {
      const token = 'invalidtoken';
      const password = 'NewP@ssw0rd!';

      mockValidatePassword.mockReturnValue(password);
      mockResetTokensFindOne.mockResolvedValue(null);

      await expect(handleResetPassword({ token, password }, createContext())).rejects.toThrow(
        'Invalid or expired reset token'
      );

      expect(mockBcryptHash).not.toHaveBeenCalled();
      expect(mockUsersUpdateOne).not.toHaveBeenCalled();
    });

    test('throws error and deletes token if token is expired', async () => {
      const token = 'expiredtoken';
      const password = 'NewP@ssw0rd!';
      const userId = new ObjectId();

      mockValidatePassword.mockReturnValue(password);
      mockResetTokensFindOne.mockResolvedValue({
        userId,
        token,
        expiresAt: new Date(Date.now() - 1000), // Expired 1 second ago
        createdAt: new Date(Date.now() - 4000000),
      });

      await expect(handleResetPassword({ token, password }, createContext())).rejects.toThrow(
        'Reset token has expired'
      );

      expect(mockResetTokensDeleteOne).toHaveBeenCalledWith({ token });
      expect(mockBcryptHash).not.toHaveBeenCalled();
      expect(mockUsersUpdateOne).not.toHaveBeenCalled();
    });

    test('throws error if user not found', async () => {
      const token = 'validtoken';
      const password = 'NewP@ssw0rd!';
      const userId = new ObjectId();

      mockValidatePassword.mockReturnValue(password);
      mockResetTokensFindOne.mockResolvedValue({
        userId,
        token,
        expiresAt: new Date(Date.now() + 1000000),
        createdAt: new Date(),
      });
      mockUsersFindOne.mockResolvedValue(null);

      await expect(handleResetPassword({ token, password }, createContext())).rejects.toThrow(
        'User not found'
      );

      expect(mockBcryptHash).not.toHaveBeenCalled();
      expect(mockUsersUpdateOne).not.toHaveBeenCalled();
      expect(mockResetTokensDeleteOne).not.toHaveBeenCalled();
    });

    test('validates password before resetting', async () => {
      const token = 'validtoken';
      const weakPassword = '123';
      const userId = new ObjectId();

      mockValidatePassword.mockImplementation(() => {
        throw new Error('Password must be at least 8 characters');
      });
      mockResetTokensFindOne.mockResolvedValue({
        userId,
        token,
        expiresAt: new Date(Date.now() + 1000000),
        createdAt: new Date(),
      });

      await expect(
        handleResetPassword({ token, password: weakPassword }, createContext())
      ).rejects.toThrow('Password must be at least 8 characters');

      expect(mockBcryptHash).not.toHaveBeenCalled();
      expect(mockUsersUpdateOne).not.toHaveBeenCalled();
    });

    test('uses bcrypt with salt rounds 10', async () => {
      const token = 'validtoken';
      const password = 'SecureP@ssw0rd';
      const userId = new ObjectId();

      mockValidatePassword.mockReturnValue(password);
      mockResetTokensFindOne.mockResolvedValue({
        userId,
        token,
        expiresAt: new Date(Date.now() + 1000000),
        createdAt: new Date(),
      });
      mockUsersFindOne.mockResolvedValue({
        _id: userId,
        emails: [{ address: 'user@example.com', verified: true }],
      });
      mockBcryptHash.mockResolvedValue('hashResult');

      await handleResetPassword({ token, password }, createContext());

      expect(mockBcryptHash).toHaveBeenCalledWith(password, 10);
    });

    test('deletes reset token after successful password reset', async () => {
      const token = 'onetimetoken';
      const password = 'NewP@ssw0rd!';
      const userId = new ObjectId();

      mockValidatePassword.mockReturnValue(password);
      mockResetTokensFindOne.mockResolvedValue({
        userId,
        token,
        expiresAt: new Date(Date.now() + 1000000),
        createdAt: new Date(),
      });
      mockUsersFindOne.mockResolvedValue({
        _id: userId,
        emails: [{ address: 'user@example.com', verified: true }],
      });
      mockBcryptHash.mockResolvedValue('hashedPassword');

      await handleResetPassword({ token, password }, createContext());

      expect(mockResetTokensDeleteOne).toHaveBeenCalledWith({ token });
      expect(mockResetTokensDeleteOne).toHaveBeenCalledTimes(1);
    });
  });
});
