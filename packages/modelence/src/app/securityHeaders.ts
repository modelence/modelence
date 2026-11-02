import type { SecurityConfig } from './securityConfig';

/** Values accepted by the `Referrer-Policy` header. */
export type ReferrerPolicy =
  | 'no-referrer'
  | 'no-referrer-when-downgrade'
  | 'origin'
  | 'origin-when-cross-origin'
  | 'same-origin'
  | 'strict-origin'
  | 'strict-origin-when-cross-origin'
  | 'unsafe-url';

/** Options for the `Strict-Transport-Security` header. */
export type HstsConfig = {
  /** Seconds the browser should remember to use HTTPS only. Defaults to one year. */
  maxAge?: number;
  /** Apply the policy to every subdomain as well. Defaults to `false`. */
  includeSubDomains?: boolean;
  /**
   * Signal consent to inclusion in browsers' HSTS preload list. Requires
   * `includeSubDomains` and a `maxAge` of at least one year.
   */
  preload?: boolean;
};

export type SecurityHeader = readonly [name: string, value: string];

const ONE_YEAR_SECONDS = 31536000;
const DEFAULT_REFERRER_POLICY: ReferrerPolicy = 'strict-origin-when-cross-origin';

const REFERRER_POLICIES: ReadonlySet<string> = new Set<ReferrerPolicy>([
  'no-referrer',
  'no-referrer-when-downgrade',
  'origin',
  'origin-when-cross-origin',
  'same-origin',
  'strict-origin',
  'strict-origin-when-cross-origin',
  'unsafe-url',
]);

// CSP keywords and hash/nonce sources only work single-quoted. Unquoted, a
// browser reads `self` as a host named "self" and the policy silently blocks
// the app's own bundle — the most common way a hand-written CSP goes wrong.
const UNQUOTED_KEYWORD =
  /^(self|none|unsafe-inline|unsafe-eval|unsafe-hashes|strict-dynamic|wasm-unsafe-eval|report-sample|inline-speculation-rules|(nonce|sha256|sha384|sha512)-.+)$/i;

const QUOTED_SOURCE =
  /^'(self|unsafe-inline|unsafe-eval|unsafe-hashes|wasm-unsafe-eval|report-sample|inline-speculation-rules|sha(256|384|512)-[A-Za-z0-9+/_-]+={0,2})'$/i;

const HASH_SOURCE = /^'sha(256|384|512)-/i;

function normalizeScriptSource(entry: string): string {
  if (typeof entry !== 'string' || entry.trim() === '') {
    throw new Error(
      `Invalid security.scriptSrc entry: expected a non-empty string, received ${JSON.stringify(entry)}.`
    );
  }

  const trimmed = entry.trim();

  // Whitespace, ';' and ',' would let one entry smuggle in further sources,
  // a new directive, or a second policy into the header.
  if (/[\s;,]/.test(trimmed)) {
    throw new Error(
      `Invalid security.scriptSrc entry ${JSON.stringify(entry)}: list one source per entry.`
    );
  }
  // Node rejects anything outside visible ASCII in a header value, but only
  // when the response is sent — every request would 500 instead of startup
  // failing once.
  if (!/^[\x21-\x7e]+$/.test(trimmed)) {
    throw new Error(
      `Invalid security.scriptSrc entry ${JSON.stringify(entry)}: only printable ASCII is ` +
        'allowed. Write internationalized hostnames in punycode.'
    );
  }
  if (UNQUOTED_KEYWORD.test(trimmed)) {
    throw new Error(
      `Invalid security.scriptSrc entry ${JSON.stringify(entry)}: CSP keywords must be ` +
        `single-quoted. Use "'${trimmed}'" instead.`
    );
  }
  if (trimmed === '*') {
    throw new Error(
      "Invalid security.scriptSrc entry '*': it allows scripts from any host, which defeats " +
        'the policy. List the script hosts the app needs instead.'
    );
  }

  const lower = trimmed.toLowerCase();
  if (lower === "'none'") {
    throw new Error(
      "Invalid security.scriptSrc entry \"'none'\": 'none' cannot be combined with the " +
        "'self' source that is always included. Use an empty list for script-src 'self'."
    );
  }
  // A nonce is only a defence when it is unpredictable and fresh per response.
  // One fixed in config is readable from any served page, so an attacker can
  // reuse it and the policy looks strict while allowing injected scripts.
  if (lower.startsWith("'nonce-")) {
    throw new Error(
      `Invalid security.scriptSrc entry ${JSON.stringify(entry)}: a nonce must be generated ` +
        'per response, so a static one offers no protection. Use a hash or a host source instead.'
    );
  }
  // 'strict-dynamic' makes CSP3 browsers ignore 'self' and every host source,
  // and the framework has no nonce to hand the app's bundle, so it would block
  // the app itself.
  if (lower === "'strict-dynamic'") {
    throw new Error(
      "Invalid security.scriptSrc entry \"'strict-dynamic'\": it disables 'self' and host " +
        "sources, which would block the app's own bundle."
    );
  }
  // Browsers silently drop a quoted token they don't recognise, so a typo like
  // 'unsafe-evall' would look configured while doing nothing.
  if (trimmed.startsWith("'") && !QUOTED_SOURCE.test(trimmed)) {
    throw new Error(
      `Invalid security.scriptSrc entry ${JSON.stringify(entry)}: not a recognised CSP keyword ` +
        "or hash. Expected one of 'self', 'unsafe-eval', 'unsafe-inline', 'unsafe-hashes', " +
        "'wasm-unsafe-eval', 'report-sample', or 'sha256-<base64>' (also sha384/sha512)."
    );
  }

  return trimmed;
}

export function normalizeScriptSrc(scriptSrc: string[]): string[] {
  if (!Array.isArray(scriptSrc)) {
    throw new Error(
      `Invalid security.scriptSrc: expected an array of CSP sources, received ${JSON.stringify(scriptSrc)}.`
    );
  }
  return scriptSrc.map(normalizeScriptSource);
}

export function normalizeHsts(hsts: boolean | HstsConfig): boolean | HstsConfig {
  if (typeof hsts === 'boolean') {
    return hsts;
  }
  if (hsts === null || typeof hsts !== 'object' || Array.isArray(hsts)) {
    throw new Error(
      `Invalid security.hsts: expected a boolean or { maxAge, includeSubDomains, preload }, ` +
        `received ${JSON.stringify(hsts)}.`
    );
  }

  const { maxAge, includeSubDomains, preload } = hsts;
  if (maxAge !== undefined && !(Number.isInteger(maxAge) && maxAge >= 0)) {
    throw new Error(
      `Invalid security.hsts.maxAge: expected a non-negative integer number of seconds, ` +
        `received ${JSON.stringify(maxAge)}.`
    );
  }
  // Preload-list submission rejects a header that fails either rule, and a
  // preload entry is very hard to undo, so catch the mismatch before deploy.
  if (preload && !includeSubDomains) {
    throw new Error('Invalid security.hsts: preload requires includeSubDomains: true.');
  }
  if (preload && (maxAge ?? ONE_YEAR_SECONDS) < ONE_YEAR_SECONDS) {
    throw new Error(
      `Invalid security.hsts: preload requires a maxAge of at least ${ONE_YEAR_SECONDS} seconds.`
    );
  }

  return hsts;
}

export function normalizeNoSniff(noSniff: boolean): boolean {
  if (typeof noSniff !== 'boolean') {
    throw new Error(
      `Invalid security.noSniff: expected a boolean, received ${JSON.stringify(noSniff)}.`
    );
  }
  return noSniff;
}

export function normalizeReferrerPolicy(policy: ReferrerPolicy | false): ReferrerPolicy | false {
  if (policy === false || REFERRER_POLICIES.has(policy)) {
    return policy;
  }
  throw new Error(
    `Invalid security.referrerPolicy ${JSON.stringify(policy)}: expected false or one of ` +
      `${[...REFERRER_POLICIES].join(', ')}.`
  );
}

function buildScriptSrc(scriptSrc: string[], dev: boolean): string {
  // The Vite dev server's React Refresh preamble is an inline script, so a
  // strict policy would blank the page in development. Production builds load
  // only external bundles from the app's own origin.
  //
  // Hashes are dropped in dev because browsers ignore 'unsafe-inline' whenever
  // a hash is present; 'unsafe-inline' already allows what they would.
  const sources = dev
    ? ["'self'", ...scriptSrc.filter((source) => !HASH_SOURCE.test(source)), "'unsafe-inline'"]
    : ["'self'", ...scriptSrc];
  return `script-src ${[...new Set(sources)].join(' ')}`;
}

function buildHsts({ maxAge = ONE_YEAR_SECONDS, includeSubDomains, preload }: HstsConfig): string {
  return [
    `max-age=${maxAge}`,
    ...(includeSubDomains ? ['includeSubDomains'] : []),
    ...(preload ? ['preload'] : []),
  ].join('; ');
}

/**
 * Computes the security headers sent on every response from an already
 * validated config. Built once at startup, since the config cannot change
 * after the server starts.
 */
export function buildSecurityHeaders(
  config: SecurityConfig,
  { dev }: { dev: boolean }
): ReadonlyArray<SecurityHeader> {
  const { frameAncestors, scriptSrc, hsts, referrerPolicy, noSniff } = config;
  const hasCustomAncestors = Boolean(frameAncestors && frameAncestors.length > 0);
  const ancestors = hasCustomAncestors ? ["'self'", ...frameAncestors!].join(' ') : "'self'";

  const directives = [
    `frame-ancestors ${ancestors}`,
    ...(scriptSrc ? [buildScriptSrc(scriptSrc, dev)] : []),
  ];
  const referrer = referrerPolicy ?? DEFAULT_REFERRER_POLICY;

  const headers: SecurityHeader[] = [
    ['Content-Security-Policy', directives.join('; ')],
    // X-Frame-Options only supports DENY and SAMEORIGIN (ALLOW-FROM is deprecated).
    // When custom ancestors are configured, only CSP frame-ancestors can express that,
    // so we omit X-Frame-Options to avoid conflicting with the CSP directive.
    ...(hasCustomAncestors ? [] : [['X-Frame-Options', 'SAMEORIGIN'] as const]),
    ...(noSniff === false ? [] : [['X-Content-Type-Options', 'nosniff'] as const]),
    ...(referrer === false ? [] : [['Referrer-Policy', referrer] as const]),
    ...(hsts ? [['Strict-Transport-Security', buildHsts(hsts === true ? {} : hsts)] as const] : []),
  ];

  return Object.freeze(headers);
}
