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
 * // Allow a browser client on another origin to call this app's API (e.g. Expo
 * // Web, which Metro serves on :8081 while the API runs on :3000). Applies to
 * // module routes and framework API routes, not to SSR pages or static assets.
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
   * Origins allowed to read this app's responses from a browser (CORS).
   *
   * Browsers block a cross-origin `fetch` unless the response carries a
   * matching `Access-Control-Allow-Origin`. The common case is Expo Web, which
   * Metro serves on a different port from the API — a different port is a
   * different origin, so every method call is blocked without this.
   *
   * Scope: this covers your module routes and the framework's own API routes
   * (method calls and the OAuth endpoints). SSR pages and static assets are
   * excluded, so a listed origin can call your API but cannot read your rendered
   * pages with credentials.
   *
   * The scope is derived from the routes actually registered, not matched by
   * path prefix: module routes carry no framework-imposed prefix (the docs'
   * example mounts `/todos` at the root), so a prefix rule would silently drop
   * CORS from the user-defined routes that most need it.
   *
   * Each entry must be an exact origin (`scheme://host[:port]`); patterns and
   * wildcards are not supported, since the response header carries one concrete
   * origin. Entries are normalized (trimmed, lowercased, default port and
   * trailing slash dropped) to match what browsers send, and anything that is
   * not a valid origin throws at startup rather than silently never matching.
   *
   * The matched origin is echoed back rather than `*`, and
   * `Access-Control-Allow-Credentials` is sent, so the browser will expose a
   * credentialed response to JS. Note this only covers same-site requests: the
   * auth cookie is `SameSite=Lax`, so a genuinely cross-site caller
   * (`app.example.com` → `api.other.com`) never has the cookie attached in the
   * first place, regardless of this setting. The Expo Web case works because
   * `localhost:8081` and `localhost:3000` differ only by port, and port is not
   * part of a site.
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

/**
 * Canonicalizes a configured origin into the form browsers actually send in the
 * `Origin` header, so the middleware can match it with a plain string compare.
 *
 * Browsers lowercase the scheme and host, omit the default port, and never
 * include a path — so `http://LOCALHOST:8081` and `http://localhost:8081/` must
 * both collapse to `http://localhost:8081` or they would silently never match.
 *
 * Throws rather than skipping a bad entry: a typo here surfaces to the developer
 * as an opaque CORS failure in the browser with nothing logged server-side, so
 * failing at startup is the only place it is cheap to diagnose.
 */
function normalizeOrigin(entry: string): string {
  if (typeof entry !== 'string' || entry.trim() === '') {
    throw new Error(
      `Invalid security.allowedOrigins entry: expected a non-empty string, received ${JSON.stringify(entry)}.`
    );
  }

  const trimmed = entry.trim();

  // Called out separately from the generic parse failure below: '*' is a
  // plausible guess that would parse as neither an origin nor a URL, and the
  // reason it is unsupported (credentialed requests) is worth stating.
  if (trimmed === '*') {
    throw new Error(
      "Invalid security.allowedOrigins entry '*': wildcards are not supported, since the " +
        'response echoes one concrete origin to keep credentialed requests working. ' +
        'List each allowed origin explicitly.'
    );
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(
      `Invalid security.allowedOrigins entry ${JSON.stringify(entry)}: expected an origin of the ` +
        "form 'scheme://host[:port]' (for example 'http://localhost:8081')."
    );
  }

  // URL keeps userinfo and a query/fragment out of `origin`, so they would be
  // silently dropped rather than rejected. Reject them: they signal the author
  // meant something the allowlist cannot express.
  if (url.username || url.password) {
    throw new Error(
      `Invalid security.allowedOrigins entry ${JSON.stringify(entry)}: an origin must not carry credentials.`
    );
  }
  if (url.search || url.hash) {
    throw new Error(
      `Invalid security.allowedOrigins entry ${JSON.stringify(entry)}: an origin must not carry a query or fragment.`
    );
  }
  // Checked before the path rule below: for a non-special scheme the whole
  // opaque body lands in `pathname`, so the path rule would fire first and
  // suggest the useless 'null' origin. `localhost:8081` (no scheme) parses this
  // way too, which is exactly the typo worth naming clearly.
  //
  // Non-special schemes (and opaque ones like `data:`) serialize as 'null',
  // which would otherwise match the opaque origin sandboxed iframes send.
  if (url.origin === 'null') {
    throw new Error(
      `Invalid security.allowedOrigins entry ${JSON.stringify(entry)}: expected an origin of the ` +
        "form 'scheme://host[:port]' (for example 'http://localhost:8081'). " +
        `Scheme ${JSON.stringify(url.protocol.replace(':', ''))} does not form a comparable origin.`
    );
  }
  // A bare origin parses with pathname '/' — anything longer is a real path.
  if (url.pathname !== '/') {
    throw new Error(
      `Invalid security.allowedOrigins entry ${JSON.stringify(entry)}: an origin must not include a path. ` +
        `Use ${JSON.stringify(url.origin)} instead.`
    );
  }

  // `URL.origin` is exactly the serialization browsers send: lowercased, default
  // port dropped, no trailing slash.
  return url.origin;
}

function normalizeAllowedOrigins(allowedOrigins: string[]): string[] {
  if (!Array.isArray(allowedOrigins)) {
    throw new Error(
      `Invalid security.allowedOrigins: expected an array of origin strings, received ${JSON.stringify(allowedOrigins)}.`
    );
  }
  return allowedOrigins.map(normalizeOrigin);
}

export function setSecurityConfig(newSecurityConfig: SecurityConfig) {
  const validated = newSecurityConfig.allowedOrigins
    ? {
        ...newSecurityConfig,
        allowedOrigins: normalizeAllowedOrigins(newSecurityConfig.allowedOrigins),
      }
    : newSecurityConfig;
  securityConfig = Object.freeze(Object.assign({}, securityConfig, validated));
}

export function getSecurityConfig() {
  return securityConfig;
}
