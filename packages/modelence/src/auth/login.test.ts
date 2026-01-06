import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { ObjectId } from 'mongodb';

const mockConsumeRateLimit = jest.fn();
const mockFindOne = jest.fn();
const mockSetSessionUser = jest.fn();
const mockClearSessionUser = jest.fn();
const mockSendVerificationEmail = jest.fn();
const mockValidateEmail = jest.fn();
const mockGetEmailConfig = jest.fn();
const mockGetAuthConfig = jest.fn();
const mockCompare = jest.fn();

jest.unstable_mockModule('@/server', () => ({
  consumeRateLimit: mockConsumeRateLimit,
}));

jest.unstable_mockModule('./db', () => ({
  usersCollection: {
    findOne: mockFindOne,
  },
}));

jest.unstable_mockModule('./session', () => ({
  setSessionUser: mockSetSessionUser,
  clearSessionUser: mockClearSessionUser,
}));

jest.unstable_mockModule('./verification', () => ({
  sendVerificationEmail: mockSendVerificationEmail,
}));

jest.unstable_mockModule('./validators', () => ({
  validateEmail: mockValidateEmail,
}));

jest.unstable_mockModule('@/app/emailConfig', () => ({
  getEmailConfig: mockGetEmailConfig,
}));

jest.unstable_mockModule('@/app/authConfig', () => ({
  getAuthConfig: mockGetAuthConfig,
}));

jest.unstable_mockModule('bcrypt', () => ({
  default: {
    compare: mockCompare,
  },
  compare: mockCompare,
}));

const { handleLoginWithPassword, handleLogout } = await import('./login');

describe('auth/login', () => {
  const baseContext = {
    session: { authToken: 'token-1', userId: null, expiresAt: new Date() },
    user: null,
    roles: [],
    connectionInfo: { ip: '203.0.113.1', baseUrl: 'https://app.example.com' },
  };

  let authConfig: {
    onAfterLogin: jest.Mock;
    onLoginError: jest.Mock;
    login: {
      onSuccess: jest.Mock;
      onError: jest.Mock;
    };
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockValidateEmail.mockImplementation((value) => value);
    mockGetEmailConfig.mockReturnValue({ provider: null });
    mockConsumeRateLimit.mockResolvedValue(undefined as never);
    mockSendVerificationEmail.mockResolvedValue(undefined as never);
    mockCompare.mockResolvedValue(true as never);

    authConfig = {
      onAfterLogin: jest.fn(),
      onLoginError: jest.fn(),
      login: {
        onSuccess: jest.fn(),
        onError: jest.fn(),
      },
    };
    mockGetAuthConfig.mockReturnValue(authConfig);
  });

  test('handles successful password login', async () => {
    const userId = new ObjectId('507f1f77bcf86cd799439011');
    mockFindOne.mockResolvedValue({
      _id: userId,
      handle: 'demo',
      authMethods: { password: { hash: 'hashed' } },
      emails: [{ address: 'user@example.com', verified: true }],
    } as never);

    const result = await handleLoginWithPassword(
      { email: 'user@example.com', password: 'Secret123' },
      baseContext as never
    );

    expect(mockValidateEmail).toHaveBeenCalledWith('user@example.com');
    expect(mockConsumeRateLimit).toHaveBeenCalledWith({
      bucket: 'signin',
      type: 'ip',
      value: '203.0.113.1',
    });
    expect(mockCompare).toHaveBeenCalledWith('Secret123', 'hashed');
    expect(mockSetSessionUser).toHaveBeenCalledWith('token-1', userId);
    expect(authConfig.onAfterLogin).toHaveBeenCalledWith({
      provider: 'email',
      user: expect.objectContaining({ _id: userId }),
      session: baseContext.session,
      connectionInfo: baseContext.connectionInfo,
    });
    expect(authConfig.login.onSuccess).toHaveBeenCalledWith(
      expect.objectContaining({ _id: userId })
    );
    expect(result).toEqual({
      user: {
        id: userId,
        handle: 'demo',
      },
    });
  });

  test('resends verification email when email is unverified and provider configured', async () => {
    const userId = new ObjectId('507f1f77bcf86cd799439012');
    mockFindOne.mockResolvedValue({
      _id: userId,
      handle: 'demo',
      authMethods: { password: { hash: 'hashed' } },
      emails: [{ address: 'user@example.com', verified: false }],
    } as never);
    mockGetEmailConfig.mockReturnValue({ provider: 'resend' });

    await expect(
      handleLoginWithPassword(
        { email: 'user@example.com', password: 'Secret123' },
        baseContext as never
      )
    ).rejects.toThrow(
      "Your email address hasn't been verified yet. We've sent a new verification email to your inbox."
    );

    expect(mockConsumeRateLimit).toHaveBeenNthCalledWith(1, {
      bucket: 'signin',
      type: 'ip',
      value: '203.0.113.1',
    });
    expect(mockConsumeRateLimit).toHaveBeenNthCalledWith(2, {
      bucket: 'verification',
      type: 'user',
      value: userId.toString(),
    });
    expect(mockSendVerificationEmail).toHaveBeenCalledWith({
      userId,
      email: 'user@example.com',
      baseUrl: 'https://app.example.com',
    });
    expect(authConfig.onLoginError).toHaveBeenCalledWith({
      provider: 'email',
      error: expect.any(Error),
      session: baseContext.session,
      connectionInfo: baseContext.connectionInfo,
    });
    expect(authConfig.login.onError).toHaveBeenCalledWith(expect.any(Error));
  });

  test('throws incorrect credentials error when password comparison fails', async () => {
    const userId = new ObjectId('507f1f77bcf86cd799439013');
    mockFindOne.mockResolvedValue({
      _id: userId,
      handle: 'demo',
      authMethods: { password: { hash: 'hashed' } },
      emails: [{ address: 'user@example.com', verified: true }],
    } as never);
    mockCompare.mockResolvedValue(false as never);

    await expect(
      handleLoginWithPassword(
        { email: 'user@example.com', password: 'wrong' },
        baseContext as never
      )
    ).rejects.toThrow('Incorrect email/password combination');

    expect(mockSetSessionUser).not.toHaveBeenCalled();
    expect(authConfig.onLoginError).toHaveBeenCalled();
    expect(authConfig.login.onError).toHaveBeenCalled();
  });

  test('handleLogout clears session user when session exists', async () => {
    await handleLogout({}, baseContext as never);
    expect(mockClearSessionUser).toHaveBeenCalledWith('token-1');
  });

  test('handleLogout throws when session missing', async () => {
    await expect(handleLogout({}, { ...baseContext, session: null } as never)).rejects.toThrow(
      'Session is not initialized'
    );
  });
});
