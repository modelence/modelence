import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { MockedFunction } from 'vitest';

const mockCallMethod = vi.fn();
const mockSetCurrentUser = vi.fn();

vi.doMock('../../client/method', () => ({
  callMethod: mockCallMethod,
}));

vi.doMock('../../client/session', () => ({
  setCurrentUser: mockSetCurrentUser,
}));

const mockGetClientConfig = vi.fn();
vi.doMock('../../client/clientConfig', () => ({
  getClientConfig: mockGetClientConfig,
}));

const mockGetLocalStorageSession = vi.fn();
const mockClearLocalStorageSession = vi.fn();
const mockSetLocalStorageSession = vi.fn();
vi.doMock('../../client/localStorage', () => ({
  clearLocalStorageSession: mockClearLocalStorageSession,
  getLocalStorageSession: mockGetLocalStorageSession,
  setLocalStorageSession: mockSetLocalStorageSession,
}));
const mockFetch: MockedFunction<typeof fetch> = vi.fn();
globalThis.fetch = mockFetch;

const authClient = await import('./index');

Object.defineProperty(globalThis, 'window', {
  value: { location: { href: '', protocol: 'http:' } },
  writable: true,
});

describe('auth/client', () => {
  beforeEach(() => {
    window.location.href = '';
    vi.clearAllMocks();
    mockGetClientConfig.mockReturnValue(null);
    mockFetch.mockResolvedValue(new Response(null, { status: 200 }));
  });

  test('signupWithPassword forwards credentials to server method', async () => {
    await authClient.signupWithPassword({ email: 'user@example.com', password: 'secret' });

    expect(mockCallMethod).toHaveBeenCalledWith('_system.user.signupWithPassword', {
      email: 'user@example.com',
      password: 'secret',
    });
  });

  test('loginWithPassword resolves user and stores the browser session', async () => {
    const rawUser = { id: '1', handle: 'demo', roles: [] };
    const enrichedUser = { ...rawUser, hasRole: () => true, requireRole: () => {} };
    const session = { authToken: 'password-token' };
    mockCallMethod.mockResolvedValue({ user: rawUser, session } as never);
    mockSetCurrentUser.mockReturnValue(enrichedUser);

    const result = await authClient.loginWithPassword({
      email: 'user@example.com',
      password: 'secret',
    });

    expect(mockCallMethod).toHaveBeenCalledWith('_system.user.loginWithPassword', {
      email: 'user@example.com',
      password: 'secret',
    });
    expect(mockSetLocalStorageSession).toHaveBeenCalledWith(session);
    expect(mockSetCurrentUser).toHaveBeenCalledWith(rawUser);
    expect(result).toBe(enrichedUser);
  });

  test('loginWithPassword stores the token through custom client configuration', async () => {
    const setAuthToken = vi.fn();
    mockGetClientConfig.mockReturnValue({ setAuthToken });
    const session = { authToken: 'custom-client-token' };
    mockCallMethod.mockResolvedValue({
      user: { id: '1', handle: 'demo', roles: [] },
      session,
    } as never);

    await authClient.loginWithPassword({ email: 'user@example.com', password: 'secret' });

    expect(setAuthToken).toHaveBeenCalledWith(session.authToken);
    expect(mockSetLocalStorageSession).not.toHaveBeenCalled();
  });

  test('loginWithMagicLink stores the browser session', async () => {
    const user = { id: '1', handle: 'demo', roles: [] };
    const session = { authToken: 'magic-link-token' };
    mockCallMethod.mockResolvedValue({ user, session } as never);

    await authClient.loginWithMagicLink();

    expect(mockCallMethod).toHaveBeenCalledWith('_system.user.loginWithMagicLink');
    expect(mockSetLocalStorageSession).toHaveBeenCalledWith(session);
  });

  test('loginWithOneTimeCode stores the browser session', async () => {
    const user = { id: '1', handle: 'demo', roles: [] };
    const session = { authToken: 'one-time-code-token' };
    mockCallMethod.mockResolvedValue({ user, session } as never);

    await authClient.loginWithOneTimeCode({ email: 'user@example.com', code: '123456' });

    expect(mockCallMethod).toHaveBeenCalledWith('_system.user.loginWithOneTimeCode', {
      email: 'user@example.com',
      code: '123456',
    });
    expect(mockSetLocalStorageSession).toHaveBeenCalledWith(session);
  });

  test('verifyEmail calls backend method with token', async () => {
    await authClient.verifyEmail({ token: 'token123' });

    expect(mockCallMethod).toHaveBeenCalledWith('_system.user.verifyEmail', { token: 'token123' });
  });

  test('resendEmailVerification calls backend method with email', async () => {
    await authClient.resendEmailVerification({ email: 'user@example.com' });

    expect(mockCallMethod).toHaveBeenCalledWith('_system.user.resendEmailVerification', {
      email: 'user@example.com',
    });
  });

  test('logout calls backend method and clears current user', async () => {
    await authClient.logout();

    expect(mockCallMethod).toHaveBeenCalledWith('_system.user.logout');
    expect(mockClearLocalStorageSession).toHaveBeenCalledTimes(1);
    expect(mockSetCurrentUser).toHaveBeenCalledWith(null);
  });

  test('sendResetPasswordToken requests reset email', async () => {
    await authClient.sendResetPasswordToken({ email: 'user@example.com' });

    expect(mockCallMethod).toHaveBeenCalledWith('_system.user.sendResetPasswordToken', {
      email: 'user@example.com',
    });
  });

  test('resetPassword submits token and password when token is provided', async () => {
    await authClient.resetPassword({ token: 'token123', password: 'newpass' });

    expect(mockCallMethod).toHaveBeenCalledWith('_system.user.resetPassword', {
      token: 'token123',
      password: 'newpass',
    });
  });

  test('resetPassword submits only the password when token is omitted (cookie exchange)', async () => {
    await authClient.resetPassword({ password: 'newpass' });

    expect(mockCallMethod).toHaveBeenCalledWith('_system.user.resetPassword', {
      password: 'newpass',
    });
  });

  test('linkOAuthProvider calls set-link-cookie endpoint when token exists', async () => {
    mockGetLocalStorageSession.mockReturnValue({ authToken: 'test-token' });

    await authClient.linkOAuthProvider({ provider: 'google' });

    expect(mockFetch).toHaveBeenCalledWith('/api/_internal/auth/set-link-cookie', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ authToken: 'test-token' }),
      credentials: 'include',
    });
    expect(window.location.href).toBe('/api/_internal/auth/google?mode=link');
  });

  test('linkOAuthProvider throws error and halts redirect when set-link-cookie fails', async () => {
    mockGetLocalStorageSession.mockReturnValue({ authToken: 'test-token' });

    mockFetch.mockResolvedValue(new Response(null, { status: 401 }));

    await expect(authClient.linkOAuthProvider({ provider: 'google' })).rejects.toThrow(
      'Failed to initialize OAuth linking. Please ensure you are logged in.'
    );

    expect(window.location.href).toBe('');
  });

  test('linkOAuthProvider does not call set-link-cookie when token is missing', async () => {
    mockGetLocalStorageSession.mockReturnValue(undefined);

    await authClient.linkOAuthProvider({ provider: 'google' });

    expect(mockFetch).not.toHaveBeenCalled();
    expect(window.location.href).toBe('/api/_internal/auth/google?mode=link');
  });

  test('unlinkOAuthProvider calls backend method with provider', async () => {
    await authClient.unlinkOAuthProvider({ provider: 'google' });

    expect(mockCallMethod).toHaveBeenCalledWith('_system.user.unlinkOAuthProvider', {
      provider: 'google',
    });
  });

  test('unlinkOAuthProvider calls backend method for github', async () => {
    await authClient.unlinkOAuthProvider({ provider: 'github' });

    expect(mockCallMethod).toHaveBeenCalledWith('_system.user.unlinkOAuthProvider', {
      provider: 'github',
    });
  });
});
