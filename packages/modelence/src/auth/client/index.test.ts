import { beforeEach, describe, expect, jest, test } from '@jest/globals';

const mockCallMethod = jest.fn();
const mockSetCurrentUser = jest.fn();

jest.unstable_mockModule('../../client/method', () => ({
  callMethod: mockCallMethod,
}));

jest.unstable_mockModule('../../client/session', () => ({
  setCurrentUser: mockSetCurrentUser,
}));

const authClient = await import('./index');

describe('auth/client', () => {
  beforeEach(() => {
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
    const user = { id: '1', handle: 'demo', roles: [], hasRole: () => true, requireRole: () => {} };
    mockCallMethod.mockResolvedValue({ user } as never);

    const result = await authClient.loginWithPassword({
      email: 'user@example.com',
      password: 'secret',
    });

    expect(mockCallMethod).toHaveBeenCalledWith('_system.user.loginWithPassword', {
      email: 'user@example.com',
      password: 'secret',
    });
    expect(mockSetCurrentUser).toHaveBeenCalledWith(user);
    expect(result).toBe(user);
  });

  test('verifyEmail calls backend method with token', async () => {
    await authClient.verifyEmail({ token: 'token123' });

    expect(mockCallMethod).toHaveBeenCalledWith('_system.user.verifyEmail', { token: 'token123' });
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
});
