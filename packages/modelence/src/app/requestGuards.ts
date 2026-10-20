import type { Request, RequestHandler } from 'express';
import { getConfig } from '@/config/server';
import { getSecurityConfig } from './securityConfig';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Rejects any request whose body is not JSON.
 *
 * These routes authenticate from the `authToken` cookie, which the browser
 * attaches to same-site requests. A page can only send a cross-origin body
 * without a CORS preflight when it is a "simple" request — form-encoded,
 * multipart, text/plain, or no body at all — so any page on a sibling
 * subdomain could otherwise call a method as the signed-in user with a plain
 * HTML form. Requiring `application/json` forces a preflight, which only
 * `security.allowedOrigins` can pass.
 *
 * Rejecting outright, rather than just not parsing the other types, matters:
 * a body-less or text/plain request still reaches the handler with
 * `args === undefined`, which is enough to invoke a method that takes no
 * arguments.
 */
export function requireJsonBody(): RequestHandler {
  return (req, res, next) => {
    if (req.is('application/json')) {
      next();
      return;
    }
    res.setHeader('X-Modelence-Error-Code', 'UNSUPPORTED_CONTENT_TYPE');
    res.status(415).send('Expected Content-Type: application/json');
  };
}

/**
 * Rejects state-changing requests a browser sent from a foreign origin.
 *
 * Defense in depth behind {@link requireJsonBody}. Follows the algorithm of
 * Go's `net/http` `CrossOriginProtection`: trust `Sec-Fetch-Site` when the
 * browser sends it, otherwise compare `Origin` with the request host. Requests
 * carrying neither header are not from a browser (React Native, server-to-server,
 * curl) and cannot ride on a victim's cookies, so they pass.
 *
 * The app's own origin is always allowed, as are `security.allowedOrigins` and
 * the configured site URL — the latter covers proxies that rewrite `Host`
 * without setting `X-Forwarded-Host`.
 */
export function crossOriginProtection(): RequestHandler {
  const { allowedOrigins } = getSecurityConfig();
  const allowed = new Set(allowedOrigins ?? []);

  return (req, res, next) => {
    if (isRequestFromAllowedOrigin(req, allowed)) {
      next();
      return;
    }
    res.setHeader('X-Modelence-Error-Code', 'CROSS_ORIGIN_REQUEST_BLOCKED');
    res.status(403).send('Cross-origin request blocked');
  };
}

function isRequestFromAllowedOrigin(req: Request, allowed: Set<string>): boolean {
  if (SAFE_METHODS.has(req.method)) {
    return true;
  }

  const origin = getSingleHeader(req, 'origin');
  const secFetchSite = getSingleHeader(req, 'sec-fetch-site');

  if (secFetchSite !== undefined) {
    // `none` is a user-initiated navigation (address bar, bookmark).
    if (secFetchSite === 'same-origin' || secFetchSite === 'none') {
      return true;
    }
    return isTrustedOrigin(origin, allowed);
  }

  if (origin === undefined) {
    return true;
  }

  return isOwnHost(req, origin) || isTrustedOrigin(origin, allowed);
}

function isTrustedOrigin(origin: string | undefined, allowed: Set<string>): boolean {
  if (origin === undefined) {
    return false;
  }
  return allowed.has(origin) || origin === getSiteOrigin();
}

/**
 * Compares hosts only, as Go does: the scheme the app sees behind a TLS-
 * terminating proxy is often `http` even though the browser is on `https`.
 */
function isOwnHost(req: Request, origin: string): boolean {
  const originUrl = parseUrl(origin);
  if (!originUrl?.host) {
    // Covers the literal `null` origin sent by sandboxed iframes and
    // cross-origin redirects.
    return false;
  }

  // A browser page cannot set X-Forwarded-Host on a form or no-cors request,
  // so honoring it here does not hand the attacker a bypass.
  const forwardedHost = getSingleHeader(req, 'x-forwarded-host')?.split(',')[0]?.trim();
  const host = getSingleHeader(req, 'host');
  // Parse with the origin's scheme so a proxy forwarding an explicit default
  // port (`app.example.com:443`) still matches the port-less Origin.
  return [forwardedHost, host].some(
    (candidate) =>
      candidate !== undefined &&
      parseUrl(`${originUrl.protocol}//${candidate}`)?.host === originUrl.host
  );
}

function getSiteOrigin(): string | undefined {
  const siteUrl = getConfig('_system.site.url');
  return typeof siteUrl === 'string' ? parseUrl(siteUrl)?.origin : undefined;
}

function parseUrl(value: string): URL | undefined {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

function getSingleHeader(req: Request, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}
