/**
 * Security configuration for the application
 *
 * By default, the app is protected against clickjacking by setting
 * `Content-Security-Policy: frame-ancestors 'self'` and `X-Frame-Options: SAMEORIGIN`
 * on all responses, preventing the app from being embedded in iframes on other domains.
 *
 * @example
 * ```typescript
 * import { startApp } from 'modelence/server';
 *
 * // Allow embedding in iframes on specific domains
 * startApp({
 *   security: {
 *     frameAncestors: ['https://modelence.com', 'https://app.example.com'],
 *     trustedProxies: ['loopback', 'linklocal', 'uniquelocal'],
 *     clientIpHeader: 'cf-connecting-ip',
 *   },
 * });
 * ```
 */
export type SecurityConfig = {
  /**
   * Additional origins allowed to embed this app in an iframe.
   * The app's own origin (`'self'`) is always included automatically.
   *
   * When not set, only same-origin framing is allowed.
   * When set, `X-Frame-Options` is omitted since it cannot express multiple origins.
   */
  frameAncestors?: string[];

  /**
   * IP addresses or CIDR ranges of reverse proxies that are allowed to supply
   * the client IP through `X-Forwarded-For`. This uses Express's `trust proxy`
   * address syntax, which also supports the named ranges `loopback`,
   * `linklocal`, and `uniquelocal`.
   *
   * For backward compatibility, all proxy addresses are trusted when neither
   * this option nor `MODELENCE_TRUSTED_PROXIES` is set. Configure one of them in
   * production so only addresses that cannot be reached directly by untrusted
   * clients are trusted. Once configured,
   * `connectionInfo.ip` is resolved by walking the proxy chain from the app
   * toward the client and stopping at the first untrusted address. This keeps a
   * caller from choosing its rate-limit identity by prepending a forged
   * `X-Forwarded-For` value.
   *
   * @example
   * ```typescript
   * trustedProxies: ['loopback', '10.0.0.0/8']
   * ```
   */
  trustedProxies?: string | string[];

  /**
   * Name of a single-value header the trusted proxy sets to the originating
   * client IP, used instead of walking the `X-Forwarded-For` chain.
   *
   * Cloudflare recommends reading `CF-Connecting-IP` (or `True-Client-IP` on
   * Enterprise plans) rather than `X-Forwarded-For`, because Cloudflare
   * *appends* to an inbound `X-Forwarded-For` instead of overwriting it, while
   * these headers always carry exactly one address.
   *
   * This header is only read when the immediate peer is a trusted proxy, so
   * `trustedProxies` (or `MODELENCE_TRUSTED_PROXIES`) must also be configured
   * with the proxy's addresses. Without that, a direct caller could set the
   * header themselves and choose their own rate-limit identity. When the peer
   * is untrusted or the header is absent, the IP falls back to the normal
   * `trust proxy` resolution.
   *
   * @example
   * ```typescript
   * // Behind Cloudflare, with Cloudflare's published ranges trusted:
   * clientIpHeader: 'cf-connecting-ip'
   * ```
   */
  clientIpHeader?: string;
};

let securityConfig: SecurityConfig = Object.freeze({});

export function setSecurityConfig(newSecurityConfig: SecurityConfig) {
  securityConfig = Object.freeze(Object.assign({}, securityConfig, newSecurityConfig));
}

export function getSecurityConfig() {
  return securityConfig;
}
