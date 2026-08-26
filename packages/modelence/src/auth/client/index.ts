import { setCurrentUser } from '@/client/session';
import { callMethod } from '@/client/method';
import { getLocalStorageSession } from '@/client/localStorage';
import { getClientConfig } from '@/client/clientConfig';
import type { ClientInfo } from '@/methods/types';
import { OAuthProvider } from '../types';
import { consumeOAuthVerifier, startOAuthVerifier } from './oauthVerifier';

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
 * Stores the session from a completed sign-in and returns the enriched user.
 *
 * Every login method ends the same way — persist the auth token through the
 * client config, then publish the user to the reactive session store. Kept in
 * one place so a new sign-in method cannot half-implement it.
 */
function completeLogin(result: { user: RawUserData; session: { authToken: string } }) {
  const config = getClientConfig();
  if (config) {
    config.setAuthToken(result.session.authToken);
  }
  return setCurrentUser(result.user);
}

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
  const result = await callMethod<{ user: RawUserData; session: { authToken: string } }>(
    '_system.user.loginWithPassword',
    {
      email,
      password,
    }
  );
  return completeLogin(result);
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
  const result = await callMethod<{ user: RawUserData; session: { authToken: string } }>(
    '_system.user.loginWithMagicLink'
  );
  return completeLogin(result);
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
  const result = await callMethod<{ user: RawUserData; session: { authToken: string } }>(
    '_system.user.loginWithOneTimeCode',
    { email, code }
  );
  return completeLogin(result);
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
 * Start an OAuth sign-in.
 *
 * On the web this navigates to the provider and the flow finishes on its own —
 * the session cookie is set and the browser lands back on your site.
 *
 * Pass `redirectUri` to run the native flow: the device browser opens the
 * provider, and when the flow completes Modelence redirects back to that deep
 * link with a single-use `code` query parameter. Hand that code to
 * {@link loginWithOAuth} to finish signing in. The redirect target must be
 * listed in the server's `auth.mobile.redirectUrls`, otherwise the request is
 * rejected before the provider is ever reached.
 *
 * The native flow additionally binds the sign-in to this device: a verifier is
 * held in memory here and replayed by `loginWithOAuth`, so a `code` delivered
 * to the app from outside this flow cannot be redeemed.
 *
 * @example Web
 * ```ts
 * await signInWithOAuth({ provider: 'google' });
 * ```
 *
 * @example React Native
 * ```ts
 * import { parseDeepLinkParams } from 'modelence/client';
 *
 * await signInWithOAuth({ provider: 'google', redirectUri: 'myapp://auth' });
 *
 * Linking.addEventListener('url', async ({ url }) => {
 *   const { code } = parseDeepLinkParams(url);
 *   if (code) await loginWithOAuth({ code });
 * });
 * ```
 * @param options.provider - The OAuth provider to sign in with ('google' or 'github').
 * @param options.redirectUri - Deep link to return to. Required on React Native.
 */
export async function signInWithOAuth(options: {
  provider: OAuthProvider;
  redirectUri?: string;
}): Promise<void> {
  const { provider, redirectUri } = options;
  const config = getClientConfig();
  const baseUrl = config?.baseUrl ?? '';

  // `redirectUri` — not the presence of `openUrl` — decides the flow. An
  // Electron or Capacitor client may set `openUrl` purely to control how links
  // open while still completing the ordinary cookie-based web flow.
  if (redirectUri) {
    if (!config?.openUrl) {
      throw new Error(
        'signInWithOAuth was given a redirectUri but the client has no openUrl. ' +
          'Configure openUrl (e.g. (url) => Linking.openURL(url)) to use the native flow.'
      );
    }

    const codeChallenge = startOAuthVerifier();
    const url =
      `${baseUrl}/api/_internal/auth/${provider}?mode=login&platform=mobile` +
      `&redirectUri=${encodeURIComponent(redirectUri)}` +
      `&codeChallenge=${encodeURIComponent(codeChallenge)}`;
    config.openUrl(url);
    return;
  }

  const webUrl = `${baseUrl}/api/_internal/auth/${provider}?mode=login`;
  if (config?.openUrl) {
    config.openUrl(webUrl);
    return;
  }

  window.location.href = webUrl;
}

/**
 * Complete a native OAuth sign-in with the code from the deep link.
 *
 * Exchanges the single-use code that {@link signInWithOAuth} delivered to your
 * app's deep link for a session, stores the auth token, and returns the
 * signed-in user. Codes are valid for one minute and can only be redeemed once.
 *
 * Pairs with `signInWithOAuth({ provider, redirectUri })` — the flow that hands
 * a code back to your app. It works on native and under Expo Web, where the
 * verifier is kept in `sessionStorage` so it survives the navigation to the
 * provider. A plain web app that calls `signInWithOAuth({ provider })` with no
 * `redirectUri` is signed in by a session cookie and never needs this.
 *
 * The verifier minted by `signInWithOAuth` is replayed here, which is what
 * makes a code usable only by the client that started the flow. Calling this
 * without a preceding `signInWithOAuth` — as a crafted deep link would — fails
 * before the code is ever sent.
 *
 * @example
 * ```ts
 * const user = await loginWithOAuth({ code });
 * ```
 * @param options.code - The `code` query parameter from the deep link.
 */
export async function loginWithOAuth(options: { code: string }) {
  const { code } = options;

  const codeVerifier = consumeOAuthVerifier();
  if (!codeVerifier) {
    // Thrown mid-flow, after the user has pressed a button, so apps surface it in
    // the UI — keep the thrown message something an end user can act on and put
    // the integration cause in the console for whoever is debugging it.
    console.error(
      '[modelence] loginWithOAuth was called with no sign-in in progress. ' +
        'Either signInWithOAuth was never called on this client, or the code came ' +
        'from somewhere other than a flow this client started. On native, the app ' +
        'process must survive the round trip; in a browser the verifier is kept in ' +
        'sessionStorage, so a new tab or a cleared session also produces this. ' +
        'A plain web app that never calls signInWithOAuth({ redirectUri }) does not ' +
        'need loginWithOAuth at all — the cookie flow signs the user in on its own.'
    );

    throw new Error('This sign-in link is no longer valid. Please sign in again.');
  }

  const result = await callMethod<{ user: RawUserData; session: { authToken: string } }>(
    '_system.user.loginWithOAuth',
    { code, codeVerifier }
  );
  return completeLogin(result);
}

/**
 * Link an OAuth provider to the currently signed-in user's account.
 * Redirects the browser to the OAuth provider's authorization page.
 * The provider will redirect back and the account will be linked.
 *
 * Without `redirectUri` this navigates the current context and authenticates
 * with an httpOnly cookie, so it only works where the navigation stays in the
 * same cookie jar — a browser, or a webview that navigates in place. Clients
 * whose `openUrl` opens an external browser (Electron, Capacitor) must pass a
 * `redirectUri`: that flow carries a single-use nonce in the URL and does not
 * depend on cookies.
 *
 * @example
 * ```ts
 * linkOAuthProvider({ provider: 'google' });
 * ```
 * @param options.provider - The OAuth provider to link ('google' or 'github').
 * @param options.redirectUri - Deep link to return to once linking completes.
 *   Required for React Native and any client that opens URLs externally; must be
 *   listed in the server's `auth.mobile.redirectUrls`. Without it the flow ends
 *   wherever the navigation lands rather than back in the app.
 */
export async function linkOAuthProvider(options: {
  provider: OAuthProvider;
  redirectUri?: string;
}): Promise<void> {
  const { provider, redirectUri } = options;
  const config = getClientConfig();
  const baseUrl = config?.baseUrl ?? '';

  if (redirectUri) {
    if (!config?.openUrl) {
      throw new Error(
        'linkOAuthProvider was given a redirectUri but the client has no openUrl. ' +
          'Configure openUrl (e.g. (url) => Linking.openURL(url)) to use the native flow.'
      );
    }
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
    const url =
      `${baseUrl}/api/_internal/auth/${provider}?mode=link` +
      `&linkNonce=${encodeURIComponent(nonce)}` +
      `&platform=mobile&redirectUri=${encodeURIComponent(redirectUri)}`;
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
    // Deliberately a same-context navigation, not `config.openUrl` — unlike the
    // web path of `signInWithOAuth`, which is stateless and works in any
    // browser. This flow authenticates via the httpOnly `oauthLinkToken` cookie
    // just set on this origin, so the navigation that follows must come from the
    // same cookie jar. Handing the URL to `openUrl` would, in an Electron or
    // Capacitor client, open a system browser that never received that cookie,
    // and linking would fail as unauthenticated. Such clients should pass a
    // `redirectUri` and use the nonce-based flow above, whose credential travels
    // in the URL and is therefore jar-independent.
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
