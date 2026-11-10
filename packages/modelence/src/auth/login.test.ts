import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { Mock } from 'vitest';
import { ObjectId } from 'mongodb';

const mockConsumeRateLimit = vi.fn();
const mockCheckRateLimit = vi.fn();
const mockReleaseRateLimits = vi.fn();
const mockFindOne = vi.fn();
const FRESH_AUTH_TOKEN = 'fresh-auth-token';
const mockStartUserSession = vi.fn(async (_previousAuthToken: string | null, userId: unknown) => ({
  authToken: FRESH_AUTH_TOKEN,
  userId,
  expiresAt: new Date(),
}));
const mockClearSessionUser = vi.fn();
const mockSetAuthTokenCookie = vi.fn();
const mockSendVerificationEmail = vi.fn();
const mockValidateEmail = vi.fn();
const mockGetEmailConfig = vi.fn();
const mockGetAuthConfig = vi.fn();
const mockGetConfig = vi.fn();
const mockCompare = vi.fn();
const mockHashSync = vi.fn(() => '$2b$10$dummyDummyDummyDummyDummyDummyDummyDummy');

vi.doMock('@/server', () => ({
  consumeRateLimit: mockConsumeRateLimit,
  checkRateLimit: mockCheckRateLimit,
  releaseRateLimits: mockReleaseRateLimits,
}));

vi.doMock('./db', () => ({
  usersCollection: {
    findOne: mockFindOne,
  },
}));

vi.doMock('./session', () => ({
  startUserSession: mockStartUserSession,
  clearSessionUser: mockClearSessionUser,
  setAuthTokenCookie: mockSetAuthTokenCookie,
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
    hashSync: mockHashSync,
  },
  compare: mockCompare,
  hashSync: mockHashSync,
}));

const { handleLoginWithPassword, handleLogout } = await import('./login');
const { AuthError, RateLimitError } = await import('../error');

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
    mockConsumeRateLimit.mockResolvedValue([] as never);
    mockCheckRateLimit.mockResolvedValue(undefined as never);
    mockReleaseRateLimits.mockResolvedValue(undefined as never);
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
    expect(mockConsumeRateLimit).toHaveBeenCalledWith({
      bucket: 'signin',
      type: 'email',
      value: 'user@example.com',
    });
    const emailReservationIndex = mockConsumeRateLimit.mock.calls.findIndex(
      ([options]) => options.type === 'email'
    );
    // The reservation is taken before bcrypt, closing the check-then-act race.
    expect(mockConsumeRateLimit.mock.invocationCallOrder[emailReservationIndex]).toBeLessThan(
      mockCompare.mock.invocationCallOrder[0]
    );
    expect(mockReleaseRateLimits).toHaveBeenCalledTimes(1);
    expect(mockCompare).toHaveBeenCalledWith('Secret123', 'hashed');
    expect(mockStartUserSession).toHaveBeenCalledWith('token-1', userId);
    expect(authConfig.onAfterLogin).toHaveBeenCalledWith({
      provider: 'email',
      user: expect.objectContaining({ _id: userId }),
      session: expect.objectContaining({ authToken: FRESH_AUTH_TOKEN, userId }),
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
      session: { authToken: FRESH_AUTH_TOKEN },
    });
  });

  test('runs bcrypt against a dummy hash when the email is unknown', async () => {
    mockFindOne.mockResolvedValue(null as never);

    await expect(
      handleLoginWithPassword(
        { email: 'unknown@example.com', password: 'Secret123' },
        baseContext as never
      )
    ).rejects.toThrow('Incorrect email/password combination');

    expect(mockCompare).toHaveBeenCalledWith('Secret123', expect.stringMatching(/^\$2b\$10\$/));
    expect(mockCheckRateLimit).toHaveBeenCalledWith({
      bucket: 'signin',
      type: 'email',
      value: 'unknown@example.com',
    });
    expect(mockConsumeRateLimit).toHaveBeenCalledWith({
      bucket: 'signin',
      type: 'email',
      value: 'unknown@example.com',
    });
  });

  test('runs bcrypt against a dummy hash for accounts without a password', async () => {
    const userId = new ObjectId('507f1f77bcf86cd799439014');
    mockFindOne.mockResolvedValue({
      _id: userId,
      handle: 'demo',
      authMethods: {},
      emails: [{ address: 'user@example.com', verified: true }],
    } as never);

    await expect(
      handleLoginWithPassword(
        { email: 'user@example.com', password: 'Secret123' },
        baseContext as never
      )
    ).rejects.toThrow('Incorrect email/password combination');

    expect(mockCompare).toHaveBeenCalledWith('Secret123', expect.stringMatching(/^\$2b\$10\$/));
    expect(mockConsumeRateLimit).toHaveBeenCalledWith({
      bucket: 'signin',
      type: 'email',
      value: 'user@example.com',
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

    expect(mockConsumeRateLimit).toHaveBeenCalledTimes(2);
    expect(mockConsumeRateLimit).toHaveBeenCalledWith({
      bucket: 'signin',
      type: 'ip',
      value: '203.0.113.1',
    });
    expect(mockConsumeRateLimit).toHaveBeenCalledWith({
      bucket: 'signin',
      type: 'email',
      value: 'user@example.com',
    });
    expect(mockReleaseRateLimits).toHaveBeenCalledTimes(1);
    expect(mockSendVerificationEmail).not.toHaveBeenCalled();
    expect(authConfig.onLoginError).toHaveBeenCalledWith({
      provider: 'email',
      error: expect.any(Error),
      session: baseContext.session,
      connectionInfo: baseContext.connectionInfo,
    });
    expect(authConfig.login.onError).toHaveBeenCalledWith(expect.any(Error));
  });

  test('does not reveal an unverified email when the password is incorrect', async () => {
    const userId = new ObjectId('507f1f77bcf86cd799439023');
    mockFindOne.mockResolvedValue({
      _id: userId,
      handle: 'demo',
      authMethods: { password: { hash: 'hashed' } },
      emails: [{ address: 'user@example.com', verified: false }],
    } as never);
    mockGetEmailConfig.mockReturnValue({ provider: 'resend' });
    mockCompare.mockResolvedValue(false as never);

    await expect(
      handleLoginWithPassword(
        { email: 'user@example.com', password: 'wrong' },
        baseContext as never
      )
    ).rejects.toThrow('Incorrect email/password combination');
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

    expect(mockStartUserSession).toHaveBeenCalledWith('token-1', userId);
    expect(result.session).toEqual({ authToken: FRESH_AUTH_TOKEN });
  });

  test('issues a new token instead of authenticating the pre-login one', async () => {
    const userId = new ObjectId('507f1f77bcf86cd799439011');
    mockFindOne.mockResolvedValue({
      _id: userId,
      handle: 'demo',
      authMethods: { password: { hash: 'hashed' } },
      emails: [{ address: 'user@example.com', verified: true }],
    } as never);
    const res = {};

    const result = await handleLoginWithPassword(
      { email: 'user@example.com', password: 'Secret123' },
      { ...baseContext, res } as never
    );

    // A token planted before sign-in (session fixation) must not become the
    // user's session: the pre-login token is retired and a new one is sent back.
    expect(mockStartUserSession).toHaveBeenCalledWith('token-1', userId);
    expect(result.session).toEqual({ authToken: FRESH_AUTH_TOKEN });
    expect(mockSetAuthTokenCookie).toHaveBeenCalledWith(res, FRESH_AUTH_TOKEN);
    expect(mockSetAuthTokenCookie).not.toHaveBeenCalledWith(res, 'token-1');
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

    expect(mockStartUserSession).toHaveBeenCalledWith('token-1', userId);
    expect(result.session).toEqual({ authToken: FRESH_AUTH_TOKEN });
  });

  test('answers an unknown email and a wrong password with the same 401 AuthError', async () => {
    mockFindOne.mockResolvedValue(null as never);
    const unknownEmail = await handleLoginWithPassword(
      { email: 'unknown@example.com', password: 'Secret123' },
      baseContext as never
    ).catch((error: unknown) => error);

    mockFindOne.mockResolvedValue({
      _id: new ObjectId('507f1f77bcf86cd799439015'),
      handle: 'demo',
      authMethods: { password: { hash: 'hashed' } },
      emails: [{ address: 'user@example.com', verified: true }],
    } as never);
    mockCompare.mockResolvedValue(false as never);
    const wrongPassword = await handleLoginWithPassword(
      { email: 'user@example.com', password: 'wrong' },
      baseContext as never
    ).catch((error: unknown) => error);

    for (const error of [unknownEmail, wrongPassword]) {
      expect(error).toBeInstanceOf(AuthError);
      expect(error).toMatchObject({
        status: 401,
        message: 'Incorrect email/password combination',
      });
    }
    // Identical responses, so a caller can't tell which emails are registered.
    expect((wrongPassword as InstanceType<typeof AuthError>).code).toBe(
      (unknownEmail as InstanceType<typeof AuthError>).code
    );
    // Both paths consume the same email bucket and pass the same pre-check, so
    // neither reveals whether the address is registered.
    expect(
      mockConsumeRateLimit.mock.calls.filter(([options]) => options.type === 'email')
    ).toHaveLength(2);
    expect(
      mockCheckRateLimit.mock.calls.filter(([options]) => options.type === 'email')
    ).toHaveLength(2);
    expect(mockReleaseRateLimits).not.toHaveBeenCalled();
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

    expect(mockStartUserSession).not.toHaveBeenCalled();
    expect(authConfig.onLoginError).toHaveBeenCalled();
    expect(authConfig.login.onError).toHaveBeenCalled();
  });

  test('throttles failed sign-in attempts per email across different IPs', async () => {
    mockFindOne.mockResolvedValue({
      _id: new ObjectId('507f1f77bcf86cd799439031'),
      handle: 'demo',
      authMethods: { password: { hash: 'hashed' } },
      emails: [{ address: 'user@example.com', verified: true }],
    } as never);
    mockCompare.mockResolvedValue(false as never);

    let emailFailures = 0;
    mockCheckRateLimit.mockImplementation((options: { type: string }) => {
      // Mirror the default 10-attempts-per-15-minutes rule.
      if (options.type === 'email' && emailFailures >= 10) {
        return Promise.reject(new RateLimitError('Rate limit exceeded for signin'));
      }
      return Promise.resolve();
    });
    mockConsumeRateLimit.mockImplementation((options: { type: string }) => {
      if (options.type === 'email') {
        emailFailures += 1;
      }
      return Promise.resolve([]);
    });

    for (let attempt = 0; attempt < 10; attempt++) {
      await expect(
        handleLoginWithPassword({ email: 'user@example.com', password: 'wrong' }, {
          ...baseContext,
          connectionInfo: { ip: `198.51.100.${attempt + 1}` },
        } as never)
      ).rejects.toThrow('Incorrect email/password combination');
    }

    const error = await handleLoginWithPassword({ email: 'user@example.com', password: 'wrong' }, {
      ...baseContext,
      connectionInfo: { ip: '198.51.100.11' },
    } as never).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(RateLimitError);
    expect(error).toMatchObject({ status: 429 });
    // The 11th attempt is blocked before bcrypt and does not consume the bucket.
    expect(emailFailures).toBe(10);
    expect(mockCompare).toHaveBeenCalledTimes(10);
    expect(
      mockConsumeRateLimit.mock.calls.filter(([options]) => options.type === 'email')
    ).toHaveLength(10);
    expect(
      mockCheckRateLimit.mock.calls.filter(([options]) => options.type === 'email')
    ).toHaveLength(11);
    expect(mockReleaseRateLimits).not.toHaveBeenCalled();
  });

  test('rejects a correct password with a 429 once the email limit is reached', async () => {
    mockFindOne.mockResolvedValue({
      _id: new ObjectId('507f1f77bcf86cd799439033'),
      handle: 'demo',
      authMethods: { password: { hash: 'hashed' } },
      emails: [{ address: 'user@example.com', verified: true }],
    } as never);
    mockCompare.mockResolvedValue(true as never);
    mockCheckRateLimit.mockRejectedValue(new RateLimitError('Rate limit exceeded for signin'));

    const error = await handleLoginWithPassword(
      { email: 'user@example.com', password: 'Secret123' },
      baseContext as never
    ).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(RateLimitError);
    expect(error).toMatchObject({ status: 429 });
    expect(mockCheckRateLimit).toHaveBeenCalledWith({
      bucket: 'signin',
      type: 'email',
      value: 'user@example.com',
    });
    // The password is never compared once the email budget is exhausted.
    expect(mockCompare).not.toHaveBeenCalled();
    expect(mockStartUserSession).not.toHaveBeenCalled();
    expect(
      mockConsumeRateLimit.mock.calls.filter(([options]) => options.type === 'email')
    ).toHaveLength(0);
    expect(mockReleaseRateLimits).not.toHaveBeenCalled();
  });

  test('rejects before bcrypt when a concurrent request fills the email limit', async () => {
    mockFindOne.mockResolvedValue({
      _id: new ObjectId('507f1f77bcf86cd799439034'),
      handle: 'demo',
      authMethods: { password: { hash: 'hashed' } },
      emails: [{ address: 'user@example.com', verified: true }],
    } as never);
    mockCompare.mockResolvedValue(true as never);
    mockConsumeRateLimit.mockImplementation((options: { type: string }) => {
      if (options.type === 'email') {
        return Promise.reject(new RateLimitError('Rate limit exceeded for signin'));
      }
      return Promise.resolve([]);
    });

    const error = await handleLoginWithPassword(
      { email: 'user@example.com', password: 'Secret123' },
      baseContext as never
    ).catch((e: unknown) => e);

    // The check passed, but a concurrent request filled the bucket before this
    // one could reserve its slot.
    expect(error).toBeInstanceOf(RateLimitError);
    expect(error).toMatchObject({ status: 429 });
    expect(mockCompare).not.toHaveBeenCalled();
    expect(mockReleaseRateLimits).not.toHaveBeenCalled();
  });

  test('releases the email reservation when bcrypt throws', async () => {
    mockFindOne.mockResolvedValue({
      _id: new ObjectId('507f1f77bcf86cd799439035'),
      handle: 'demo',
      authMethods: { password: { hash: 'hashed' } },
      emails: [{ address: 'user@example.com', verified: true }],
    } as never);
    mockCompare.mockRejectedValue(new Error('bcrypt exploded'));

    await expect(
      handleLoginWithPassword(
        { email: 'user@example.com', password: 'Secret123' },
        baseContext as never
      )
    ).rejects.toThrow('bcrypt exploded');

    // The password was never checked, so the attempt should not stay counted.
    expect(mockReleaseRateLimits).toHaveBeenCalledTimes(1);
  });

  test('does not reserve an email slot when the user lookup fails', async () => {
    mockFindOne.mockRejectedValue(new Error('db down'));

    await expect(
      handleLoginWithPassword(
        { email: 'user@example.com', password: 'Secret123' },
        baseContext as never
      )
    ).rejects.toThrow('db down');

    expect(
      mockConsumeRateLimit.mock.calls.filter(([options]) => options.type === 'email')
    ).toHaveLength(0);
    expect(mockReleaseRateLimits).not.toHaveBeenCalled();
  });

  test('does not count successful logins against the email limit', async () => {
    mockFindOne.mockResolvedValue({
      _id: new ObjectId('507f1f77bcf86cd799439032'),
      handle: 'demo',
      authMethods: { password: { hash: 'hashed' } },
      emails: [{ address: 'user@example.com', verified: true }],
    } as never);
    mockCompare.mockResolvedValue(true as never);
    const reservation = {
      bucket: 'signin',
      type: 'email',
      value: 'user@example.com',
      windowMs: 15 * 60 * 1000,
      windowStart: new Date('2024-01-01T00:00:00.000Z'),
    };
    mockConsumeRateLimit.mockImplementation((options: { type: string }) =>
      options.type === 'email' ? Promise.resolve([reservation]) : Promise.resolve([])
    );

    await handleLoginWithPassword(
      { email: 'user@example.com', password: 'Secret123' },
      baseContext as never
    );

    // The successful attempt reserved a slot and released it, so the email
    // bucket still has no net consumption.
    expect(
      mockConsumeRateLimit.mock.calls.filter(([options]) => options.type === 'email')
    ).toHaveLength(1);
    expect(mockReleaseRateLimits).toHaveBeenCalledWith([reservation]);
    expect(mockCheckRateLimit).toHaveBeenCalledWith({
      bucket: 'signin',
      type: 'email',
      value: 'user@example.com',
    });
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

  test('throws ValidationError and skips rate limiting when user is already authenticated', async () => {
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
    expect((error as Error).name).toBe('ValidationError');
    expect((error as Error).message).toBe('User is already authenticated');
    expect((error as { code?: string }).code).toBe('ALREADY_AUTHENTICATED');
    expect(mockConsumeRateLimit).not.toHaveBeenCalled();
    expect(mockCheckRateLimit).not.toHaveBeenCalled();
    expect(mockReleaseRateLimits).not.toHaveBeenCalled();
  });
});
