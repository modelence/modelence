import { setCurrentUser } from '@/client/session';
import { callMethod } from '@/client/method';
import { clearLocalStorageSession, getLocalStorageSession } from '@/client/localStorage';
import { getClientConfig } from '@/client/clientConfig';
import type { ClientInfo } from '@/methods/types';
import { OAuthProvider } from '../types';

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
    ...(handle !== undefined ? { handle } : {}),
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
  const { user, session } = await callMethod<{ user: RawUserData; session: { authToken: string } }>(
    '_system.user.loginWithPassword',
    {
      email,
      password,
    }
  );
  const config = getClientConfig();
  if (config) {
    config.setAuthToken(session.authToken);
  }
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
    ...(firstName !== undefined ? { firstName } : {}),
    ...(lastName !== undefined ? { lastName } : {}),
    ...(avatarUrl !== undefined ? { avatarUrl } : {}),
    ...(handle !== undefined ? { handle } : {}),
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
  clearLocalStorageSession();
  const config = getClientConfig();
  if (config) {
    config.setAuthToken(null);
  }
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
 * Send a magic sign-in link to the given email address.
 *
 * Clicking the emailed link signs the user in. When the server enables
 * `auth.magicLink.allowSignup`, this also works for new users — the account is
 * created when the link is used; otherwise unknown emails receive no email.
 * A generic response is always returned to avoid leaking account information.
 *
 * @example
 * ```ts
 * await sendMagicLink({ email: 'user@example.com' });
 * ```
 * @param options.email - The email address to send the magic link to.
 */
export async function sendMagicLink(options: { email: string }) {
  const { email } = options;
  await callMethod('_system.user.sendMagicLink', {
    email,
  });
}

/**
 * Complete a magic link sign-in.
 *
 * Call this from the page the magic link landing route redirects to. The
 * token is exchanged server-side via an httpOnly cookie, so no arguments are
 * needed. Signs the user in — creating the account first when the email is
 * not registered yet and the server enables `auth.magicLink.allowSignup` —
 * and returns the logged-in user.
 *
 * @example
 * ```ts
 * const user = await loginWithMagicLink();
 * ```
 */
export async function loginWithMagicLink() {
  const { user, session } = await callMethod<{ user: RawUserData; session: { authToken: string } }>(
    '_system.user.loginWithMagicLink'
  );
  const config = getClientConfig();
  if (config) {
    config.setAuthToken(session.authToken);
  }
  const enrichedUser = setCurrentUser(user);
  return enrichedUser;
}

/**
 * Complete a magic link sign-in by typing the one-time code from the email.
 *
 * Alternative to `loginWithMagicLink()` for contexts where clicking the link
 * can't reach the app — native apps without deep links, or when the email is
 * read on a different device. Signs the user in — creating the account first
 * when the email is not registered yet and the server enables
 * `auth.magicLink.allowSignup` — and returns the logged-in user.
 *
 * @example
 * ```ts
 * const user = await loginWithOneTimeCode({ email: 'user@example.com', code: '482193' });
 * ```
 * @param options.email - The email the magic link was sent to.
 * @param options.code - The one-time code from the email.
 */
export async function loginWithOneTimeCode(options: { email: string; code: string }) {
  const { email, code } = options;
  const { user, session } = await callMethod<{ user: RawUserData; session: { authToken: string } }>(
    '_system.user.loginWithOneTimeCode',
    { email, code }
  );
  const config = getClientConfig();
  if (config) {
    config.setAuthToken(session.authToken);
  }
  const enrichedUser = setCurrentUser(user);
  return enrichedUser;
}

/**
 * Reset password.
 *
 * The token is normally exchanged server-side via an httpOnly cookie, so the
 * client only submits the new password. Pass `token` only for legacy flows
 * that still carry it client-side (deprecated).
 *
 * @param options.token - Reset token (optional; read from the httpOnly cookie when omitted).
 * @param options.password - The new password.
 */
export async function resetPassword(options: { token?: string; password: string }) {
  const { token, password } = options;
  await callMethod('_system.user.resetPassword', {
    ...(token ? { token } : {}),
    password,
  });
}

/**
 * Link an OAuth provider to the currently signed-in user's account.
 * Redirects the browser to the OAuth provider's authorization page.
 * The provider will redirect back and the account will be linked.
 *
 * @example
 * ```ts
 * linkOAuthProvider({ provider: 'google' });
 * ```
 * @param options.provider - The OAuth provider to link ('google' or 'github').
 */
export async function linkOAuthProvider(options: { provider: OAuthProvider }): Promise<void> {
  const { provider } = options;
  const config = getClientConfig();
  const baseUrl = config?.baseUrl ?? '';

  if (config?.openUrl) {
    // React Native: exchange authToken for a single-use nonce via an authenticated
    // request, then put the nonce in the URL. A crafted external link can't work
    // because the nonce is bound to this session and consumed on first use.
    const token = getAuthToken();
    if (!token) {
      throw new Error('Failed to initialize OAuth linking. Please ensure you are logged in.');
    }
    const nonceResponse = await fetch(`${baseUrl}/api/_internal/auth/issue-link-nonce`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ authToken: token }),
    });
    if (!nonceResponse.ok) {
      throw new Error('Failed to initialize OAuth linking. Please ensure you are logged in.');
    }
    const { nonce } = await nonceResponse.json();
    const url = `${baseUrl}/api/_internal/auth/${provider}?mode=link&linkNonce=${encodeURIComponent(nonce)}`;
    config.openUrl(url);
  } else {
    // Browser: set httpOnly cookie via same-origin fetch (keeps token out of redirect params).
    const token = getAuthToken();
    if (token) {
      const response = await fetch(`${baseUrl}/api/_internal/auth/set-link-cookie`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ authToken: token }),
        credentials: 'include',
      });
      if (!response.ok) {
        throw new Error('Failed to initialize OAuth linking. Please ensure you are logged in.');
      }
    }
    window.location.href = `${baseUrl}/api/_internal/auth/${provider}?mode=link`;
  }
}
/**
 * Unlink an OAuth provider from the currently signed-in user's account.
 *
 * @example
 * ```ts
 * await unlinkOAuthProvider({ provider: 'github' });
 * ```
 * @param options.provider - The OAuth provider to unlink ('google' or 'github').
 */
export async function unlinkOAuthProvider(options: { provider: OAuthProvider }): Promise<void> {
  const { provider } = options;
  await callMethod('_system.user.unlinkOAuthProvider', { provider });
}

/**
 * Get the current auth token associated with the current session.
 * @returns The auth token or undefined if not authenticated.
 */
export function getAuthToken(): string | undefined {
  const config = getClientConfig();
  if (config) {
    return config.getAuthToken();
  }
  return getLocalStorageSession()?.authToken;
}

export function getClientInfo(): ClientInfo {
  const config = getClientConfig();
  if (config) {
    return config.getClientInfo();
  }

  if (typeof window === 'undefined') {
    return {
      screenWidth: 0,
      screenHeight: 0,
      windowWidth: 0,
      windowHeight: 0,
      pixelRatio: 1,
      orientation: null,
    };
  }

  return {
    screenWidth: window.screen.width,
    screenHeight: window.screen.height,
    windowWidth: window.innerWidth,
    windowHeight: window.innerHeight,
    pixelRatio: window.devicePixelRatio,
    orientation: window.screen.orientation?.type ?? null,
  };
}
