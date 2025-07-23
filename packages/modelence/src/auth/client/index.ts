import { setCurrentUser } from '../../client/session';
import { callMethod } from '../../client/method';

export type UserInfo = {
  id: string;
  handle: string;
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
export async function signupWithPassword(options: { email: string, password: string }) {
  const { email, password } = options;
  await callMethod('_system.user.signupWithPassword', { email, password });

  // TODO: handle auto-login from the signup method itself to avoid a second method call
  await loginWithPassword({ email, password });
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
export async function loginWithPassword(options: { email: string, password: string }) {
  const { email, password } = options;
  const { user } = await callMethod<{ user: UserInfo }>('_system.user.loginWithPassword', { email, password });
  setCurrentUser(user);
  return user;
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
  const { user } = await callMethod<{ user: UserInfo }>('_system.user.verifyEmail', { token });
  setCurrentUser(user);
  return user;
}

/**
 * Logout the current user.
 * 
 */
export async function logout() {
  await callMethod('_system.user.logout');
  setCurrentUser(null);
}
