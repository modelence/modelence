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
 *
 * @example
 * ```typescript
 * // Allow a browser client on another origin to call the API (e.g. Expo Web,
 * // which Metro serves on :8081 while the API runs on :3000).
 * startApp({
 *   security: {
 *     allowedOrigins: ['http://localhost:8081'],
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
   * Origins allowed to call this app's API from a browser (CORS).
   *
   * Browsers block a cross-origin `fetch` unless the response carries a
   * matching `Access-Control-Allow-Origin`. The common case is Expo Web, which
   * Metro serves on a different port from the API — a different port is a
   * different origin, so every method call is blocked without this.
   *
   * Each entry must be an exact origin (`scheme://host[:port]`); patterns and
   * wildcards are not supported, since the response header carries one concrete
   * origin. The matched origin is echoed back rather than `*`, so credentialed
   * requests keep working.
   *
   * Opt-in by design: when unset, no CORS headers are sent at all. Deployments
   * that already add CORS at a proxy or router therefore stay untouched — a
   * duplicated `Access-Control-Allow-Origin` is invalid and would break them.
   *
   * Native iOS/Android do not enforce CORS and never need this.
   */
  allowedOrigins?: string[];
};

let securityConfig: SecurityConfig = Object.freeze({});

export function setSecurityConfig(newSecurityConfig: SecurityConfig) {
  securityConfig = Object.freeze(Object.assign({}, securityConfig, newSecurityConfig));
}

export function getSecurityConfig() {
  return securityConfig;
}
