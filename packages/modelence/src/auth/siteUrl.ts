import { getConfig } from '@/config/server';
import { getLocalSiteUrl } from '@/config/local';

/**
 * Returns the configured site URL for a link that carries a credential, such as
 * a password reset, email verification or magic link token.
 *
 * There is deliberately no fallback to a URL derived from the request: `Host`
 * and `X-Forwarded-Host` are set by the caller, so an anonymous request could
 * get a genuine token emailed inside a link to a host it controls (reset link
 * poisoning). Call this before storing the token, so a misconfigured server
 * fails without leaving an unsendable token behind.
 *
 * Under `modelence dev` an unset URL falls back to the local server's own, which
 * comes from the environment, not the request. Only an explicit
 * `NODE_ENV=development` counts: a deployed server may leave NODE_ENV unset, and
 * must fail rather than email localhost links.
 */
export function requireSiteUrl(linkName: string): string {
  const siteUrl = getConfig('_system.site.url');
  if (typeof siteUrl === 'string' && siteUrl) {
    return siteUrl;
  }
  if (process.env.NODE_ENV === 'development') {
    return getLocalSiteUrl();
  }
  throw new Error(`Unable to build ${linkName}: set _system.site.url (MODELENCE_SITE_URL)`);
}
