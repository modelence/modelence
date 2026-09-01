import { describe, expect, test } from 'vitest';

import { parseDeepLinkParams } from './deepLink';

/**
 * These cases are why the parser exists rather than `new URL(url).searchParams`:
 * bare React Native's URL implementation throws on `searchParams`, so the
 * documented deep-link snippet has to work without it.
 */
describe('auth/client/deepLink', () => {
  test('reads a code out of a custom-scheme deep link', () => {
    expect(parseDeepLinkParams('myapp://auth?code=abc123')).toEqual({ code: 'abc123' });
  });

  test('reads several parameters', () => {
    expect(parseDeepLinkParams('myapp://auth?error=Nope&errorCode=invalid_state')).toEqual({
      error: 'Nope',
      errorCode: 'invalid_state',
    });
  });

  test('percent-decodes values', () => {
    expect(parseDeepLinkParams('myapp://auth?error=User%20account%20is%20not%20active.')).toEqual({
      error: 'User account is not active.',
    });
  });

  // The server builds these with URLSearchParams, which encodes spaces as '+'.
  test('decodes + as a space', () => {
    expect(parseDeepLinkParams('myapp://auth?error=Not+active')).toEqual({ error: 'Not active' });
  });

  test('returns nothing when there is no query string', () => {
    expect(parseDeepLinkParams('myapp://auth')).toEqual({});
  });

  test('ignores a fragment', () => {
    expect(parseDeepLinkParams('myapp://auth?code=abc#section')).toEqual({ code: 'abc' });
  });

  test('handles a valueless parameter', () => {
    expect(parseDeepLinkParams('myapp://auth?code=')).toEqual({ code: '' });
  });

  // A deep link is attacker-reachable input; a malformed escape must not take
  // down the app's link handler.
  test('does not throw on a malformed percent escape', () => {
    expect(() => parseDeepLinkParams('myapp://auth?code=%zz')).not.toThrow();
    expect(parseDeepLinkParams('myapp://auth?code=%zz')).toEqual({ code: '%zz' });
  });

  // Otherwise a crafted link could shadow a legitimate earlier parameter.
  test('keeps the first occurrence of a repeated parameter', () => {
    expect(parseDeepLinkParams('myapp://auth?code=real&code=injected')).toEqual({ code: 'real' });
  });

  test('tolerates non-string input', () => {
    expect(parseDeepLinkParams(undefined as unknown as string)).toEqual({});
  });

  test('works on an https deep link too', () => {
    expect(parseDeepLinkParams('https://app.example.com/auth?code=abc')).toEqual({ code: 'abc' });
  });
});
