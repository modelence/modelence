/**
 * Query params a failed web OAuth flow reports through. Stripped from the
 * configured target before the fresh values are set, so a stale
 * `?error=` left in `oauthErrorRedirectUrl` can never shadow the real one.
 * Mirrors the mobile deep-link contract (see `mobileRedirect.ts`).
 */
const ERROR_PARAMS = ['error', 'errorCode'] as const;

export type OAuthErrorRedirectParams = {
  /** Human-readable message for display. Not a stable contract. */
  error: string;
  /** Stable identifier the app can branch on. */
  errorCode: string;
};

/**
 * Builds the absolute URL a failed web OAuth flow redirects to.
 *
 * `target` is `authConfig.oauthErrorRedirectUrl`: a server-side, trusted value,
 * so it is not allowlisted the way a mobile `redirectUri` is. A path such as
 * `/login` is resolved against `siteUrl` (`_system.site.url`), the same base
 * the email landing routes use; an absolute URL is taken as is. Existing
 * unrelated query params and any hash fragment are preserved.
 */
export function buildOAuthErrorRedirect(
  siteUrl: string,
  target: string,
  params: OAuthErrorRedirectParams
): string {
  const url = new URL(target, siteUrl);

  for (const key of ERROR_PARAMS) {
    url.searchParams.delete(key);
  }

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  return url.toString();
}
