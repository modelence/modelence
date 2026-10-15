import type { CookieOptions, Request, Response } from 'express';

/**
 * Logical names of the framework's auth cookies. The name actually sent to the
 * browser is derived from these by {@link getAuthCookieName}.
 */
export type OAuthStateCookie = 'authStateGoogle' | 'authStateGithub';

export type AuthCookie =
  | 'authToken'
  | 'oauthLinkToken'
  | 'magicLinkToken'
  | 'resetPasswordToken'
  | OAuthStateCookie;

const HOST_PREFIX = '__Host-';

/**
 * Whether auth cookies are marked `Secure`. Read per call rather than at module
 * load so tests (and anything else that flips NODE_ENV) see a consistent value.
 */
function usesSecureCookies(): boolean {
  return process.env.NODE_ENV === 'production';
}

/**
 * The name an auth cookie is stored under in the browser.
 *
 * Secure cookies carry the `__Host-` prefix. Browsers only accept a
 * `__Host-` cookie that is `Secure`, has `Path=/`, and has no `Domain`
 * attribute, so a page on a sibling subdomain (another tenant under the same
 * parent domain) cannot plant one for this host — neither via `Set-Cookie`
 * nor via `document.cookie`. Without the prefix it could set e.g.
 * `authToken; Domain=<parent>; Path=/api/...`, which the browser sends ahead
 * of ours, fixating the victim onto the attacker's session.
 *
 * Plain-HTTP development keeps the bare name: browsers reject the prefix on
 * non-secure cookies, and Safari does not treat `http://localhost` as secure.
 *
 * Deliberately no fallback to the bare name in production: honoring it would
 * reopen exactly the hole the prefix closes.
 */
export function getAuthCookieName(cookie: AuthCookie): string {
  return usesSecureCookies() ? `${HOST_PREFIX}${cookie}` : cookie;
}

/**
 * Attributes shared by every auth cookie. Setting and clearing must use the
 * same ones: browsers ignore a clear whose path doesn't match, which would
 * leave the httpOnly cookie behind. `Path=/` is required by the `__Host-`
 * prefix. `lax` rather than `strict` so the magic-link and password-reset
 * cookies survive the navigation from the email client, and the OAuth cookies
 * survive the redirect back from the provider.
 */
function getAuthCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: usesSecureCookies(),
    sameSite: 'lax',
    path: '/',
  };
}

export function setAuthCookie(
  res: Response,
  cookie: AuthCookie,
  value: string,
  maxAgeMs: number
): void {
  res.cookie(getAuthCookieName(cookie), value, { ...getAuthCookieOptions(), maxAge: maxAgeMs });
}

export function clearAuthCookie(res: Response, cookie: AuthCookie): void {
  // No maxAge here: Express 4 lets a passed maxAge override clearCookie's
  // expiry, which would re-set the cookie instead of deleting it.
  res.clearCookie(getAuthCookieName(cookie), getAuthCookieOptions());
}

export function readAuthCookie(
  req: Pick<Request, 'cookies'> | null | undefined,
  cookie: AuthCookie
): string | undefined {
  return readCookie(req?.cookies, cookie);
}

/**
 * Reads the session token from parsed request cookies.
 *
 * For custom module routes that authenticate browser requests themselves:
 * the cookie name differs between development and production (see
 * {@link getAuthCookieName}), so reading `cookies.authToken` directly breaks
 * in production.
 *
 * @example
 * ```typescript
 * handler: async ({ cookies }) => {
 *   const { user } = await authenticate(getAuthTokenFromCookies(cookies) ?? null);
 * }
 * ```
 */
export function getAuthTokenFromCookies(
  cookies: Record<string, unknown> | null | undefined
): string | undefined {
  return readCookie(cookies, 'authToken');
}

function readCookie(
  cookies: Record<string, unknown> | null | undefined,
  cookie: AuthCookie
): string | undefined {
  const value = cookies?.[getAuthCookieName(cookie)];
  return typeof value === 'string' ? value : undefined;
}
