import { setCurrentUser } from '@/client/session';
import { callMethod } from '@/client/method';
import { getLocalStorageSession } from '@/client/localStorage';
import { ClientInfo } from '@/methods/types';

export type UserInfo = {
  id: string;
  handle: string;
  roles: string[];
  hasRole: (role: string) => boolean;
  requireRole: (role: string) => void;
  firstName?: string;
  lastName?: string;
  avatarUrl?: string;
};

type RawUserData = {
  id: string;
  handle: string;
  roles: string[];
  firstName?: string;
  lastName?: string;
  avatarUrl?: string;
};

/**
 * Sign up a new user with an email and password.
 *
 * @example
 * ```ts
 * await signupWithPassword({ email: 'test@example.com', password: '12345678' });
 * await signupWithPassword({ email: 'test@example.com', password: '12345678', handle: 'myhandle', firstName: 'John' });
 * ```
 * @param options.email - The email of the user.
 * @param options.password - The password of the user.
 * @param options.handle - Optional custom handle. If omitted, one is derived from the email.
 * @param options.firstName - Optional first name.
 * @param options.lastName - Optional last name.
 * @param options.avatarUrl - Optional avatar URL.
 */
export async function signupWithPassword(options: {
  email: string;
  password: string;
  handle?: string;
  firstName?: string;
  lastName?: string;
  avatarUrl?: string;
}) {
  const { email, password, handle, firstName, lastName, avatarUrl } = options;
  await callMethod('_system.user.signupWithPassword', {
    email,
    password,
    ...(handle ? { handle } : {}),
    ...(firstName !== undefined ? { firstName } : {}),
    ...(lastName !== undefined ? { lastName } : {}),
    ...(avatarUrl !== undefined ? { avatarUrl } : {}),
  });
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
 * Update the current user's profile.
 *
 * @example
 * ```ts
 * await updateProfile({ firstName: 'Atul', lastName: 'Yadav', avatarUrl: 'https://example.com/avatar.jpg', handle: 'atulyadav' });
 * ```
 * @param options.firstName - The first name of the user.
 * @param options.lastName - The last name of the user.
 * @param options.avatarUrl - The avatar URL of the user.
 * @param options.handle - The handle of the user.
 */
export async function updateProfile(options: {
  firstName?: string;
  lastName?: string;
  avatarUrl?: string;
  handle?: string;
}) {
  const { firstName, lastName, avatarUrl, handle } = options;
  const { user } = await callMethod<{ user: RawUserData }>('_system.user.updateProfile', {
    firstName,
    lastName,
    avatarUrl,
    handle,
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
 * Resend the verification email for a given email address.
 * The email is only sent if the address is registered and not yet verified.
 * A generic response is always returned to avoid leaking account information.
 *
 * @example
 * ```ts
 * await resendEmailVerification({ email: 'user@example.com' });
 * ```
 * @param options.email - The email address to resend verification to.
 */
export async function resendEmailVerification(options: { email: string }) {
  const { email } = options;
  await callMethod('_system.user.resendEmailVerification', { email });
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

/**
 * Get the current auth token associated with the current session.
 * @returns The auth token or undefined if not authenticated.
 */
export function getAuthToken(): string | undefined {
  return getLocalStorageSession()?.authToken;
}

export function getClientInfo(): ClientInfo {
  return {
    screenWidth: window.screen.width,
    screenHeight: window.screen.height,
    windowWidth: window.innerWidth,
    windowHeight: window.innerHeight,
    pixelRatio: window.devicePixelRatio,
    orientation: window.screen.orientation?.type ?? null,
  };
}
