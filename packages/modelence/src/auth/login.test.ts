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
const mockGetConfig = vi.fn();
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
  setAuthTokenCookie: vi.fn(),
  clearAuthTokenCookie: vi.fn(),
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

vi.doMock('@/config/server', () => ({
  getConfig: mockGetConfig,
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
    res: null,
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
    // Mirror the schema default: verification is required unless explicitly disabled.
    mockGetConfig.mockImplementation((key: string) =>
      key === '_system.user.auth.email.verification' ? true : undefined
    );
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

    const error = await handleLoginWithPassword(
      { email: 'user@example.com', password: 'Secret123' },
      baseContext as never
    ).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      "Your email address hasn't been verified yet. Please check your inbox for the verification email."
    );
    expect((error as { code?: string }).code).toBe('EMAIL_NOT_VERIFIED');

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

  test('allows unverified login when verification flag is disabled', async () => {
    const userId = new ObjectId('507f1f77bcf86cd799439021');
    mockFindOne.mockResolvedValue({
      _id: userId,
      handle: 'demo',
      authMethods: { password: { hash: 'hashed' } },
      emails: [{ address: 'user@example.com', verified: false }],
    } as never);
    mockGetEmailConfig.mockReturnValue({ provider: 'resend' });
    // Operator explicitly disabled verification while keeping a provider.
    mockGetConfig.mockImplementation((key: string) =>
      key === '_system.user.auth.email.verification' ? false : undefined
    );

    const result = await handleLoginWithPassword(
      { email: 'user@example.com', password: 'Secret123' },
      baseContext as never
    );

    expect(mockSetSessionUser).toHaveBeenCalledWith('token-1', userId);
    expect(result.session).toEqual({ authToken: 'token-1' });
  });

  test('allows unverified login when no email provider is configured', async () => {
    const userId = new ObjectId('507f1f77bcf86cd799439022');
    mockFindOne.mockResolvedValue({
      _id: userId,
      handle: 'demo',
      authMethods: { password: { hash: 'hashed' } },
      emails: [{ address: 'user@example.com', verified: false }],
    } as never);
    // No provider: the flag defaults to true (see beforeEach) but verification
    // cannot be enforced without a way to deliver the email.
    mockGetEmailConfig.mockReturnValue({ provider: null });

    const result = await handleLoginWithPassword(
      { email: 'user@example.com', password: 'Secret123' },
      baseContext as never
    );

    expect(mockSetSessionUser).toHaveBeenCalledWith('token-1', userId);
    expect(result.session).toEqual({ authToken: 'token-1' });
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

  test('throws AuthError and skips rate limiting when user is already authenticated', async () => {
    const activeUser = {
      id: new ObjectId('507f1f77bcf86cd799439099'),
      handle: 'existinguser',
      roles: [],
    };

    const error = await handleLoginWithPassword(
      { email: 'user@example.com', password: 'Secret123' },
      { ...baseContext, user: activeUser } as never
    ).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('User is already authenticated');
    expect((error as { code?: string }).code).toBe('ALREADY_AUTHENTICATED');
    expect(mockConsumeRateLimit).not.toHaveBeenCalled();
  });
});
