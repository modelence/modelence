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
   * Express `trust proxy` setting, controlling how `req.protocol`, `req.ip` and
   * `req.hostname` are derived from `X-Forwarded-*` headers.
   *
   * Defaults to `true` (trusts the whole chain) — fine when the app is only
   * reachable through a trusted proxy. Tighten when self-hosting: a number is
   * trusted hop count (e.g. `1`), a string/array trusts IPs or subnets
   * (e.g. `['loopback', '10.0.0.0/8']`), `false` disables proxy trust.
   *
   * https://expressjs.com/en/guide/behind-proxies.html
   */
  trustProxy?: boolean | number | string | string[];
};

let securityConfig: SecurityConfig = Object.freeze({});

export function setSecurityConfig(newSecurityConfig: SecurityConfig) {
  securityConfig = Object.freeze(Object.assign({}, securityConfig, newSecurityConfig));
}

export function getSecurityConfig() {
  return securityConfig;
}
