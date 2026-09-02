/**
 * Query params a failed web OAuth flow reports through. Stripped from the
 * configured target before the fresh values are set, so a stale
 * `?error=` left in `oauthErrorRedirectUrl` can never shadow the real one.
 * Mirrors the mobile deep-link contract (see `mobileRedirect.ts`).
 */
const ERROR_PARAMS = ['error', 'errorCode'] as const;

/**
 * Placeholder origin used to parse a relative target. It never appears in the
 * output: a target that came in relative goes out relative.
 */
const RELATIVE_BASE = 'http://relative.invalid';

export type OAuthErrorRedirectParams = {
  /** Human-readable message for display. Not a stable contract. */
  error: string;
  /** Stable identifier the app can branch on. */
  errorCode: string;
};

/**
 * Builds the URL a failed web OAuth flow redirects to.
 *
 * `target` is `authConfig.oauthErrorRedirectUrl`: a server-side, trusted value,
 * so it is not allowlisted the way a mobile `redirectUri` is. It may be a path
 * (`/login`) or an absolute URL. Existing unrelated query params and any hash
 * fragment are preserved.
 */
export function buildOAuthErrorRedirect(target: string, params: OAuthErrorRedirectParams): string {
  const isRelative = target.startsWith('/');
  const url = new URL(target, RELATIVE_BASE);

  for (const key of ERROR_PARAMS) {
    url.searchParams.delete(key);
  }

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  return isRelative ? `${url.pathname}${url.search}${url.hash}` : url.toString();
}
