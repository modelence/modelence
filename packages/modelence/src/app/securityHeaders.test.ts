import { describe, expect, test } from 'vitest';
import {
  buildSecurityHeaders,
  normalizeHsts,
  normalizeNoSniff,
  normalizeReferrerPolicy,
  normalizeScriptSrc,
} from './securityHeaders';

const prod = { dev: false };
const dev = { dev: true };

function headerMap(headers: ReadonlyArray<readonly [string, string]>) {
  return Object.fromEntries(headers);
}

describe('buildSecurityHeaders', () => {
  test('defaults to self-only framing, nosniff and a strict-origin referrer policy', () => {
    expect(headerMap(buildSecurityHeaders({}, prod))).toEqual({
      'Content-Security-Policy': "frame-ancestors 'self'",
      'X-Frame-Options': 'SAMEORIGIN',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    });
  });

  test('custom frameAncestors omit X-Frame-Options', () => {
    const headers = headerMap(
      buildSecurityHeaders({ frameAncestors: ['https://modelence.com'] }, prod)
    );

    expect(headers['Content-Security-Policy']).toBe("frame-ancestors 'self' https://modelence.com");
    expect(headers['X-Frame-Options']).toBeUndefined();
  });

  test('does not send script-src unless configured', () => {
    const headers = headerMap(buildSecurityHeaders({}, prod));

    expect(headers['Content-Security-Policy']).not.toContain('script-src');
  });

  test("an empty scriptSrc list yields script-src 'self'", () => {
    const headers = headerMap(buildSecurityHeaders({ scriptSrc: [] }, prod));

    expect(headers['Content-Security-Policy']).toBe("frame-ancestors 'self'; script-src 'self'");
  });

  test("scriptSrc entries follow 'self' in the same CSP header", () => {
    const headers = headerMap(
      buildSecurityHeaders(
        { frameAncestors: ['https://modelence.com'], scriptSrc: ['https://js.stripe.com'] },
        prod
      )
    );

    expect(headers['Content-Security-Policy']).toBe(
      "frame-ancestors 'self' https://modelence.com; script-src 'self' https://js.stripe.com"
    );
  });

  test("does not repeat 'self' when the app lists it explicitly", () => {
    const headers = headerMap(buildSecurityHeaders({ scriptSrc: ["'self'"] }, prod));

    expect(headers['Content-Security-Policy']).toBe("frame-ancestors 'self'; script-src 'self'");
  });

  test("adds 'unsafe-inline' in dev for the Vite React Refresh preamble", () => {
    const headers = headerMap(buildSecurityHeaders({ scriptSrc: [] }, dev));

    expect(headers['Content-Security-Policy']).toBe(
      "frame-ancestors 'self'; script-src 'self' 'unsafe-inline'"
    );
  });

  test("drops hashes in dev, since they would make browsers ignore 'unsafe-inline'", () => {
    const headers = headerMap(
      buildSecurityHeaders({ scriptSrc: ["'sha256-abc='", 'https://js.stripe.com'] }, dev)
    );

    expect(headers['Content-Security-Policy']).toBe(
      "frame-ancestors 'self'; script-src 'self' https://js.stripe.com 'unsafe-inline'"
    );
  });

  test('keeps hashes in production', () => {
    const headers = headerMap(buildSecurityHeaders({ scriptSrc: ["'sha256-abc='"] }, prod));

    expect(headers['Content-Security-Policy']).toBe(
      "frame-ancestors 'self'; script-src 'self' 'sha256-abc='"
    );
  });

  test("does not add 'unsafe-inline' in production", () => {
    const headers = headerMap(buildSecurityHeaders({ scriptSrc: [] }, prod));

    expect(headers['Content-Security-Policy']).not.toContain('unsafe-inline');
  });

  test('omits HSTS by default', () => {
    expect(headerMap(buildSecurityHeaders({}, prod))['Strict-Transport-Security']).toBeUndefined();
  });

  test('hsts: true sends a one-year max-age without subdomains', () => {
    const headers = headerMap(buildSecurityHeaders({ hsts: true }, prod));

    expect(headers['Strict-Transport-Security']).toBe('max-age=31536000');
  });

  test('hsts object controls max-age, includeSubDomains and preload', () => {
    const headers = headerMap(
      buildSecurityHeaders(
        { hsts: { maxAge: 63072000, includeSubDomains: true, preload: true } },
        prod
      )
    );

    expect(headers['Strict-Transport-Security']).toBe(
      'max-age=63072000; includeSubDomains; preload'
    );
  });

  test('hsts: false sends nothing', () => {
    expect(
      headerMap(buildSecurityHeaders({ hsts: false }, prod))['Strict-Transport-Security']
    ).toBeUndefined();
  });

  test('referrerPolicy overrides the default', () => {
    const headers = headerMap(buildSecurityHeaders({ referrerPolicy: 'no-referrer' }, prod));

    expect(headers['Referrer-Policy']).toBe('no-referrer');
  });

  test('referrerPolicy: false omits the header', () => {
    expect(
      headerMap(buildSecurityHeaders({ referrerPolicy: false }, prod))['Referrer-Policy']
    ).toBeUndefined();
  });

  test('noSniff: false omits X-Content-Type-Options', () => {
    expect(
      headerMap(buildSecurityHeaders({ noSniff: false }, prod))['X-Content-Type-Options']
    ).toBeUndefined();
  });

  test('returns a frozen list', () => {
    expect(Object.isFrozen(buildSecurityHeaders({}, prod))).toBe(true);
  });
});

describe('normalizeScriptSrc', () => {
  test('trims entries', () => {
    expect(normalizeScriptSrc(['  https://cdn.example.com '])).toEqual(['https://cdn.example.com']);
  });

  test('accepts quoted keywords, hashes, hosts and schemes', () => {
    const entries = [
      "'unsafe-eval'",
      "'sha256-abc123+/='",
      'https://*.example.com',
      'https:',
      'cdn.example.com:443',
    ];

    expect(normalizeScriptSrc(entries)).toEqual(entries);
  });

  test('rejects a non-array', () => {
    expect(() => normalizeScriptSrc('https://cdn.example.com' as unknown as string[])).toThrow(
      /security\.scriptSrc: expected an array/
    );
  });

  test.each(['', '   '])('rejects empty entry %j', (entry) => {
    expect(() => normalizeScriptSrc([entry])).toThrow(/expected a non-empty string/);
  });

  test.each(["'self' https://a.com", "'self';object-src *", 'https://a.com,https://b.com'])(
    'rejects multiple sources in one entry: %j',
    (entry) => {
      expect(() => normalizeScriptSrc([entry])).toThrow(/one source per entry/);
    }
  );

  test.each(['self', 'unsafe-inline', 'strict-dynamic', 'sha256-abc=', 'none'])(
    'rejects unquoted keyword %j with a hint',
    (entry) => {
      expect(() => normalizeScriptSrc([entry])).toThrow(`'${entry}'`);
    }
  );

  test("rejects 'none' since 'self' is always included", () => {
    expect(() => normalizeScriptSrc(["'none'"])).toThrow(/'none' cannot be combined/);
  });

  test('rejects a static nonce', () => {
    expect(() => normalizeScriptSrc(["'nonce-abc123'"])).toThrow(/nonce/);
  });
  test("rejects 'strict-dynamic', which would disable 'self'", () => {
    expect(() => normalizeScriptSrc(["'strict-dynamic'"])).toThrow(/block the app's own bundle/);
  });

  test.each(["'unsafe-evall'", "'self", "'sha256-'", "'wasm-unsafe-evl'"])(
    'rejects unrecognised quoted token %j',
    (entry) => {
      expect(() => normalizeScriptSrc([entry])).toThrow(/not a recognised CSP keyword/);
    }
  );

  test('rejects a bare wildcard', () => {
    expect(() => normalizeScriptSrc(['*'])).toThrow(/defeats the policy/);
  });

  test.each(['https://exämple.com', 'https://a.com\u0000'])(
    'rejects characters Node cannot send in a header: %j',
    (entry) => {
      expect(() => normalizeScriptSrc([entry])).toThrow(/printable ASCII/);
    }
  );
});

describe('normalizeNoSniff', () => {
  test('accepts booleans', () => {
    expect(normalizeNoSniff(false)).toBe(false);
  });

  test('rejects a non-boolean', () => {
    expect(() => normalizeNoSniff('false' as unknown as boolean)).toThrow(/security\.noSniff/);
  });
});

describe('normalizeHsts', () => {
  test('passes booleans through', () => {
    expect(normalizeHsts(true)).toBe(true);
    expect(normalizeHsts(false)).toBe(false);
  });

  test.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('rejects maxAge %s', (maxAge) => {
    expect(() => normalizeHsts({ maxAge })).toThrow(/security\.hsts\.maxAge/);
  });

  test('allows maxAge 0 so a previously sent policy can be cleared', () => {
    expect(normalizeHsts({ maxAge: 0 })).toEqual({ maxAge: 0 });
  });

  test('preload requires includeSubDomains', () => {
    expect(() => normalizeHsts({ preload: true })).toThrow(/includeSubDomains/);
  });

  test('preload requires a max-age of at least one year', () => {
    expect(() => normalizeHsts({ preload: true, includeSubDomains: true, maxAge: 86400 })).toThrow(
      /31536000/
    );
  });

  test('rejects a non-object, non-boolean value', () => {
    expect(() => normalizeHsts('max-age=1' as unknown as boolean)).toThrow(
      /security\.hsts: expected/
    );
  });
});

describe('normalizeReferrerPolicy', () => {
  test('accepts every standard policy and false', () => {
    expect(normalizeReferrerPolicy('same-origin')).toBe('same-origin');
    expect(normalizeReferrerPolicy(false)).toBe(false);
  });

  test('rejects an unknown policy', () => {
    expect(() =>
      normalizeReferrerPolicy('strict-origin-when-crossorigin' as unknown as 'same-origin')
    ).toThrow(/security\.referrerPolicy/);
  });
});
