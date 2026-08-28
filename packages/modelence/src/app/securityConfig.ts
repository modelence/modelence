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
};

let securityConfig: SecurityConfig = Object.freeze({});

export function setSecurityConfig(newSecurityConfig: SecurityConfig) {
  securityConfig = Object.freeze(Object.assign({}, securityConfig, newSecurityConfig));
}

export function getSecurityConfig() {
  return securityConfig;
}
