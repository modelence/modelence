import { setCurrentUser } from '../../client/session';
import { callMethod } from '../../client/method';

export type UserInfo = {
  id: string;
  handle: string;
  roles: string[];
  hasRole: (role: string) => boolean;
  requireRole: (role: string) => void;
};

type RawUserData = {
  id: string;
  handle: string;
  roles: string[];
};

/**
 * Sign up a new user with an email and password.
 *
 * @example
 * ```ts
 * await signupWithPassword({ email: 'test@example.com', password: '12345678' });
 * ```
 * @param options.email - The email of the user.
 * @param options.password - The password of the user.
 */
export async function signupWithPassword(options: { email: string; password: string }) {
  const { email, password } = options;
  await callMethod('_system.user.signupWithPassword', { email, password });
}

/**
 * Login a user with an email and password.
 *
 * @example
 * ```ts
 * await loginWithPassword({ email: 'test@example.com', password: '12345678' });
 * ```
 * @param options.email - The email of the user.
 * @param options.password - The password of the user.
 */
export async function loginWithPassword(options: { email: string; password: string }) {
  const { email, password } = options;
  const { user } = await callMethod<{ user: RawUserData }>('_system.user.loginWithPassword', {
    email,
    password,
  });
  const enrichedUser = setCurrentUser(user);
  return enrichedUser;
}

/**
 * Verify user's email with a verification token.
 *
 * @example
 * ```ts
 * await verifyEmail({ token: 'verification-token' });
 * ```
 * @param options.token - The email verification token.
 */
export async function verifyEmail(options: { token: string }) {
  const { token } = options;
  await callMethod<{ user: RawUserData }>('_system.user.verifyEmail', { token });
}

/**
 * Logout the current user.
 *
 */
export async function logout() {
  await callMethod('_system.user.logout');
  setCurrentUser(null);
}

/**
 * Send reset password token.
 * @param options.email - The email of the user.
 */
export async function sendResetPasswordToken(options: { email: string }) {
  const { email } = options;
  await callMethod('_system.user.sendResetPasswordToken', {
    email,
  });
}

/**
 * Reset password.
 * @param options.token - The password reset token.
 * @param options.password - The new password.
 */
export async function resetPassword(options: { token: string; password: string }) {
  const { token, password } = options;
  await callMethod('_system.user.resetPassword', {
    token,
    password,
  });
}
