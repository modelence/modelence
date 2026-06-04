import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { Mock } from 'vitest';
import { ObjectId } from 'mongodb';

const mockConsumeRateLimit = vi.fn();
const mockFindOne = vi.fn();
const mockSetSessionUser = vi.fn();
const mockClearSessionUser = vi.fn();
const mockSendVerificationEmail = vi.fn();
const mockValidateEmail = vi.fn();
const mockGetEmailConfig = vi.fn();
const mockGetAuthConfig = vi.fn();
const mockCompare = vi.fn();

vi.doMock('@/server', () => ({
  consumeRateLimit: mockConsumeRateLimit,
}));

vi.doMock('./db', () => ({
  usersCollection: {
    findOne: mockFindOne,
  },
}));

vi.doMock('./session', () => ({
  setSessionUser: mockSetSessionUser,
  clearSessionUser: mockClearSessionUser,
}));

vi.doMock('./verification', () => ({
  sendVerificationEmail: mockSendVerificationEmail,
}));

vi.doMock('./validators', () => ({
  validateEmail: mockValidateEmail,
  validateHandle: vi.fn((v: string) => v),
  MAX_HANDLE_LENGTH: 50,
  MIN_HANDLE_LENGTH: 3,
}));

vi.doMock('@/app/emailConfig', () => ({
  getEmailConfig: mockGetEmailConfig,
}));

vi.doMock('@/app/authConfig', () => ({
  getAuthConfig: mockGetAuthConfig,
}));

vi.doMock('bcrypt', () => ({
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
    onAfterLogin: Mock;
    onLoginError: Mock;
    login: {
      onSuccess: Mock;
      onError: Mock;
    };
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockValidateEmail.mockImplementation((value) => value);
    mockGetEmailConfig.mockReturnValue({ provider: null });
    mockConsumeRateLimit.mockResolvedValue(undefined as never);
    mockSendVerificationEmail.mockResolvedValue(undefined as never);
    mockCompare.mockResolvedValue(true as never);

    authConfig = {
      onAfterLogin: vi.fn(),
      onLoginError: vi.fn(),
      login: {
        onSuccess: vi.fn(),
        onError: vi.fn(),
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
        roles: [],
        firstName: undefined,
        lastName: undefined,
        avatarUrl: undefined,
      },
      session: { authToken: 'token-1' },
    });
  });

  test('throws unverified error when email is unverified and provider configured', async () => {
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
      "Your email address hasn't been verified yet. Please check your inbox for the verification email."
    );

    expect(mockConsumeRateLimit).toHaveBeenCalledTimes(1);
    expect(mockConsumeRateLimit).toHaveBeenCalledWith({
      bucket: 'signin',
      type: 'ip',
      value: '203.0.113.1',
    });
    expect(mockSendVerificationEmail).not.toHaveBeenCalled();
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
