import { ObjectId } from 'mongodb';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const mockConsumeOAuthExchangeCode = vi.fn();
const mockSetSessionUser = vi.fn();
const mockFindOne = vi.fn();
const mockConsumeRateLimit = vi.fn();
const mockGetAuthConfig = vi.fn<() => Record<string, unknown>>();

vi.doMock('./session', () => ({
  consumeOAuthExchangeCode: mockConsumeOAuthExchangeCode,
  setSessionUser: mockSetSessionUser,
}));

vi.doMock('./db', () => ({
  usersCollection: { findOne: mockFindOne },
}));

vi.doMock('@/server', () => ({
  consumeRateLimit: mockConsumeRateLimit,
}));

vi.doMock('@/app/authConfig', () => ({
  getAuthConfig: mockGetAuthConfig,
}));

const { handleLoginWithOAuth } = await import('./loginWithOAuth');

const USER_ID = new ObjectId();

const userDoc = {
  _id: USER_ID,
  handle: 'user',
  roles: [],
  status: 'active',
};

function makeContext(overrides: Record<string, unknown> = {}) {
  return {
    session: { authToken: 'session-token', userId: null, expiresAt: new Date() },
    connectionInfo: { ip: '1.2.3.4' },
    ...overrides,
  } as never;
}

describe('auth/loginWithOAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthConfig.mockReturnValue({});
    mockConsumeOAuthExchangeCode.mockResolvedValue({
      userId: USER_ID.toString(),
      provider: 'google',
    });
    mockFindOne.mockResolvedValue(userDoc);
  });

  test('redeems a valid code and binds the session to the user', async () => {
    const result = await handleLoginWithOAuth({ code: 'valid-code' }, makeContext());

    expect(mockConsumeOAuthExchangeCode).toHaveBeenCalledWith('valid-code');
    expect(mockSetSessionUser).toHaveBeenCalledWith('session-token', USER_ID);
    expect(result).toEqual({
      user: expect.objectContaining({ id: USER_ID, handle: 'user' }),
      session: { authToken: 'session-token' },
    });
  });

  test('excludes deleted and disabled users from the lookup', async () => {
    await handleLoginWithOAuth({ code: 'valid-code' }, makeContext());

    expect(mockFindOne).toHaveBeenCalledWith({
      _id: USER_ID,
      status: { $nin: ['deleted', 'disabled'] },
    });
  });

  test('rejects an unknown or already-redeemed code', async () => {
    mockConsumeOAuthExchangeCode.mockResolvedValue(null);

    await expect(handleLoginWithOAuth({ code: 'spent' }, makeContext())).rejects.toThrow(
      'Invalid or expired sign-in code'
    );
    expect(mockSetSessionUser).not.toHaveBeenCalled();
  });

  test('rejects when the account was disabled after the code was minted', async () => {
    mockFindOne.mockResolvedValue(null);

    await expect(handleLoginWithOAuth({ code: 'valid-code' }, makeContext())).rejects.toThrow(
      'Invalid or expired sign-in code'
    );
    expect(mockSetSessionUser).not.toHaveBeenCalled();
  });

  // The message must not distinguish these cases, or it becomes a probe for
  // which codes exist.
  test('reports unknown and disabled-user failures identically', async () => {
    mockConsumeOAuthExchangeCode.mockResolvedValue(null);
    const unknown = await handleLoginWithOAuth({ code: 'x' }, makeContext()).catch((e) => e);

    mockConsumeOAuthExchangeCode.mockResolvedValue({
      userId: USER_ID.toString(),
      provider: 'google',
    });
    mockFindOne.mockResolvedValue(null);
    const disabled = await handleLoginWithOAuth({ code: 'y' }, makeContext()).catch((e) => e);

    expect(unknown.message).toBe(disabled.message);
  });

  test('rejects a malformed userId without querying', async () => {
    mockConsumeOAuthExchangeCode.mockResolvedValue({
      userId: 'not-an-objectid',
      provider: 'google',
    });

    await expect(handleLoginWithOAuth({ code: 'valid-code' }, makeContext())).rejects.toThrow(
      'Invalid or expired sign-in code'
    );
    expect(mockFindOne).not.toHaveBeenCalled();
  });

  test('rejects a missing or non-string code before consuming anything', async () => {
    await expect(handleLoginWithOAuth({}, makeContext())).rejects.toThrow();
    await expect(handleLoginWithOAuth({ code: '' }, makeContext())).rejects.toThrow();

    expect(mockConsumeOAuthExchangeCode).not.toHaveBeenCalled();
  });

  test('throws when no session is initialized', async () => {
    await expect(
      handleLoginWithOAuth({ code: 'valid-code' }, makeContext({ session: null }))
    ).rejects.toThrow('Session is not initialized');
  });

  test('rate-limits by IP', async () => {
    await handleLoginWithOAuth({ code: 'valid-code' }, makeContext());

    expect(mockConsumeRateLimit).toHaveBeenCalledWith({
      bucket: 'oauthExchange',
      type: 'ip',
      value: '1.2.3.4',
    });
  });

  test('skips the rate limit when no IP is available', async () => {
    await handleLoginWithOAuth({ code: 'valid-code' }, makeContext({ connectionInfo: {} }));

    expect(mockConsumeRateLimit).not.toHaveBeenCalled();
  });

  test('fires onAfterLogin with the provider the code was minted for', async () => {
    const onAfterLogin = vi.fn();
    mockGetAuthConfig.mockReturnValue({ onAfterLogin });
    mockConsumeOAuthExchangeCode.mockResolvedValue({
      userId: USER_ID.toString(),
      provider: 'github',
    });

    await handleLoginWithOAuth({ code: 'valid-code' }, makeContext());

    expect(onAfterLogin).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'github', user: userDoc })
    );
  });

  test('fires onLoginError once the provider is known', async () => {
    const onLoginError = vi.fn();
    mockGetAuthConfig.mockReturnValue({ onLoginError });
    mockFindOne.mockResolvedValue(null);

    await expect(handleLoginWithOAuth({ code: 'valid-code' }, makeContext())).rejects.toThrow();

    expect(onLoginError).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'google', error: expect.any(Error) })
    );
  });

  // Before the code is redeemed there is no provider to attribute a failure to.
  test('does not fire onLoginError when the provider is still unknown', async () => {
    const onLoginError = vi.fn();
    mockGetAuthConfig.mockReturnValue({ onLoginError });
    mockConsumeOAuthExchangeCode.mockResolvedValue(null);

    await expect(handleLoginWithOAuth({ code: 'spent' }, makeContext())).rejects.toThrow();

    expect(onLoginError).not.toHaveBeenCalled();
  });
});
