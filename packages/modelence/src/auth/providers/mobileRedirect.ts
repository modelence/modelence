import { getAuthConfig } from '@/app/authConfig';
import { getConfig } from '@/config/server';

/**
 * Schemes that must never be used as a redirect target, whatever the allowlist
 * says. These execute or read local content rather than navigating, so allowing
 * one would turn the OAuth callback into an XSS or file-disclosure vector.
 */
const FORBIDDEN_SCHEMES = new Set(['javascript:', 'data:', 'file:', 'vbscript:', 'blob:']);

function parseRedirectUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/**
 * Deep links the mobile OAuth flow may redirect back to, from both sources:
 * the `auth.mobile.redirectUrls` config value (comma-separated, Studio- and
 * env-manageable) and the typed `AuthConfig.mobile.redirectUrls` array.
 *
 * There is no default. An empty result disables mobile OAuth entirely rather
 * than falling back to something permissive.
 */
export function getAllowedMobileRedirectUrls(): string[] {
  const fromConfig = String(getConfig('_system.user.auth.mobile.redirectUrls') ?? '')
    .split(',')
    .map((url) => url.trim())
    .filter(Boolean);

  const fromAuthConfig = (getAuthConfig().mobile?.redirectUrls ?? [])
    .map((url) => String(url).trim())
    .filter(Boolean);

  return [...new Set([...fromConfig, ...fromAuthConfig])];
}

/**
 * Whether `url` is an allowed deep-link target for the mobile OAuth flow.
 *
 * Matching compares parsed scheme, host and path — never raw string prefixes,
 * which would let `myapp://authorize.evil` pass against an allowlisted
 * `myapp://auth`. A candidate may add query parameters or a fragment (the
 * callback itself appends `?code=`), but may not change where it points.
 */
export function isAllowedMobileRedirectUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return false;

  const candidate = parseRedirectUrl(url);
  if (!candidate) return false;
  if (FORBIDDEN_SCHEMES.has(candidate.protocol.toLowerCase())) return false;

  return getAllowedMobileRedirectUrls().some((allowed) => {
    const entry = parseRedirectUrl(allowed);
    if (!entry) return false;
    if (FORBIDDEN_SCHEMES.has(entry.protocol.toLowerCase())) return false;

    return (
      candidate.protocol.toLowerCase() === entry.protocol.toLowerCase() &&
      // Custom schemes (myapp://auth) parse their first segment as the host on
      // some platforms and as the pathname on others, so both must agree.
      candidate.host.toLowerCase() === entry.host.toLowerCase() &&
      normalizePath(candidate.pathname) === normalizePath(entry.pathname)
    );
  });
}

function normalizePath(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed;
}

/**
 * Appends query parameters to an already-allowlisted deep link.
 *
 * Callers must have validated `redirectUri` with {@link isAllowedMobileRedirectUrl}
 * first; this only builds the final URL.
 */
export function buildMobileRedirect(redirectUri: string, params: Record<string, string>): string {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}
