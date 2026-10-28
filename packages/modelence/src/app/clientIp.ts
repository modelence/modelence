import type { Application, Request } from 'express';
import { getSecurityConfig } from './securityConfig';

export function configureTrustedProxies(app: Application) {
  // Express's proxy-addr implementation walks X-Forwarded-For from the socket
  // toward the client and stops at the first untrusted hop.
  // This is important for IP rate limits: selecting the left-most value would
  // let a caller evade them by prepending an arbitrary address.
  const { trustedProxies } = getSecurityConfig();
  const envTrustedProxies = parseTrustedProxies(process.env.MODELENCE_TRUSTED_PROXIES);
  // Keep the historical trust-all behavior when neither setting is present so
  // upgrading does not collapse every client behind a reverse proxy into one
  // rate-limit identity. Modelence-hosted environments set the trusted proxy
  // ranges before rolling out this framework version.
  const trustProxy = envTrustedProxies ?? trustedProxies;
  app.set('trust proxy', trustProxy === undefined ? true : trustProxy);
}

/**
 * Parses the comma-separated `MODELENCE_TRUSTED_PROXIES` value into the array
 * form Express expects. Returns undefined when unset or empty so the caller can
 * fall back to the `startApp()` security config.
 */
function parseTrustedProxies(value: string | undefined): string[] | undefined {
  const entries = value
    ?.split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  return entries?.length ? entries : undefined;
}

/**
 * Whether the immediate peer on the socket is one of the configured trusted
 * proxies. Only the socket address is consulted: it is the one value in the
 * request a caller cannot forge.
 */
function isPeerTrusted(req: Request): boolean {
  const peerIp = req.socket?.remoteAddress;
  if (!peerIp) {
    return false;
  }

  // Express compiles the `trust proxy` setting into this predicate. It is
  // absent when the app was never configured (older embeddings, tests), in
  // which case we fall back to the `trust proxy` value itself.
  const trust = req.app?.get?.('trust proxy fn');
  if (typeof trust !== 'function') {
    return req.app?.get?.('trust proxy') !== false;
  }

  return Boolean(trust(peerIp, 0));
}

export function getClientIp(req: Request): string | undefined {
  // Cloudflare and similar proxies expose the originating client in a
  // single-value header. Prefer it over the X-Forwarded-For chain, which
  // Cloudflare appends to rather than overwrites, but only when the peer is a
  // trusted proxy - otherwise a direct caller could set it themselves.
  const { clientIpHeader } = getSecurityConfig();
  if (clientIpHeader && isPeerTrusted(req)) {
    const forwardedIp = req.headers[clientIpHeader.toLowerCase()];
    const clientIp = (Array.isArray(forwardedIp) ? forwardedIp[0] : forwardedIp)?.trim();
    if (clientIp) {
      return normalizeIp(clientIp);
    }
  }

  // `req.ip` only incorporates X-Forwarded-For according to the application's
  // `trust proxy` setting. Never parse the header directly: its left-most value
  // is controlled by the caller unless every ingress proxy overwrites it.
  const directIp = req.ip || req.socket?.remoteAddress;
  if (directIp) {
    return normalizeIp(directIp);
  }

  return undefined;
}

function normalizeIp(ip: string): string {
  // Remove IPv6-to-IPv4 mapping prefix
  return ip.startsWith('::ffff:') ? ip.substring(7) : ip;
}
