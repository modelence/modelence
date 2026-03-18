import { beforeEach, describe, expect, jest, test } from '@jest/globals';

const mockCallMethod = jest.fn();
const mockSetCurrentUser = jest.fn();

jest.unstable_mockModule('../../client/method', () => ({
  callMethod: mockCallMethod,
}));

jest.unstable_mockModule('../../client/session', () => ({
  setCurrentUser: mockSetCurrentUser,
}));

const mockGetLocalStorageSession = jest.fn();
jest.unstable_mockModule('../../client/localStorage', () => ({
  getLocalStorageSession: mockGetLocalStorageSession,
}));

const authClient = await import('./index');

Object.defineProperty(globalThis, 'window', {
  value: { location: { href: '', protocol: 'http:' } },
  writable: true,
});

Object.defineProperty(globalThis, 'document', {
  value: { cookie: '' },
  writable: true,
});

describe('auth/client', () => {
  beforeEach(() => {
    window.location.href = '';
    document.cookie = '';
    jest.clearAllMocks();
  });

  test('signupWithPassword forwards credentials to server method', async () => {
    await authClient.signupWithPassword({ email: 'user@example.com', password: 'secret' });

    expect(mockCallMethod).toHaveBeenCalledWith('_system.user.signupWithPassword', {
      email: 'user@example.com',
      password: 'secret',
    });
  });

  test('loginWithPassword resolves user and stores in session', async () => {
    const rawUser = { id: '1', handle: 'demo', roles: [] };
    const enrichedUser = { ...rawUser, hasRole: () => true, requireRole: () => {} };
    mockCallMethod.mockResolvedValue({ user: rawUser } as never);
    mockSetCurrentUser.mockReturnValue(enrichedUser);

    const result = await authClient.loginWithPassword({
      email: 'user@example.com',
      password: 'secret',
    });

    expect(mockCallMethod).toHaveBeenCalledWith('_system.user.loginWithPassword', {
      email: 'user@example.com',
      password: 'secret',
    });
    expect(mockSetCurrentUser).toHaveBeenCalledWith(rawUser);
    expect(result).toBe(enrichedUser);
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
    expect(mockSetCurrentUser).toHaveBeenCalledWith(null);
  });

  test('sendResetPasswordToken requests reset email', async () => {
    await authClient.sendResetPasswordToken({ email: 'user@example.com' });

    expect(mockCallMethod).toHaveBeenCalledWith('_system.user.sendResetPasswordToken', {
      email: 'user@example.com',
    });
  });

  test('resetPassword submits token and password', async () => {
    await authClient.resetPassword({ token: 'token123', password: 'newpass' });

    expect(mockCallMethod).toHaveBeenCalledWith('_system.user.resetPassword', {
      token: 'token123',
      password: 'newpass',
    });
  });

  test('linkOAuthProvider is a synchronous function', () => {
    expect(typeof authClient.linkOAuthProvider).toBe('function');
  });

  test('linkOAuthProvider sets cookie when token exists', () => {
    mockGetLocalStorageSession.mockReturnValue({ authToken: 'test-token' });

    document.cookie = ''; // reset

    authClient.linkOAuthProvider({ provider: 'google' });

    expect(document.cookie).toContain('oauth_link_token=test-token');
    expect(window.location.href).toBe('/api/_internal/auth/google?mode=link');
  });

  test('linkOAuthProvider does not set cookie when token is missing', () => {
    mockGetLocalStorageSession.mockReturnValue(undefined);

    document.cookie = ''; // reset

    authClient.linkOAuthProvider({ provider: 'google' });

    expect(document.cookie).toBe('');
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
