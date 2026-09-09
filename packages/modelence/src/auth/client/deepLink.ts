/**
 * Deep-link query parsing that works on bare React Native.
 *
 * `new URL(url).searchParams` is not usable here: React Native's `URL` is a
 * partial implementation that throws on `searchParams` access, and Expo only
 * appears to work because it installs a polyfill. Parsing the query string
 * directly keeps the documented callback snippet working on both.
 */

/**
 * Reads query parameters out of a deep link such as `myapp://auth?code=abc`.
 *
 * Only the query component is considered — everything from the first `?` up to
 * an optional `#` fragment. Values are percent-decoded, with `+` treated as a
 * space to match `application/x-www-form-urlencoded`, which is how the server's
 * `URL.searchParams.set` encodes them.
 */
export function parseDeepLinkParams(url: string): Record<string, string> {
  const params: Record<string, string> = {};

  if (typeof url !== 'string') return params;

  const queryStart = url.indexOf('?');
  if (queryStart === -1) return params;

  const fragmentStart = url.indexOf('#', queryStart);
  const query = url.slice(queryStart + 1, fragmentStart === -1 ? undefined : fragmentStart);

  for (const pair of query.split('&')) {
    if (!pair) continue;

    const eq = pair.indexOf('=');
    const rawKey = eq === -1 ? pair : pair.slice(0, eq);
    const rawValue = eq === -1 ? '' : pair.slice(eq + 1);

    const key = safeDecode(rawKey);
    if (!key) continue;

    // First occurrence wins, so a crafted link cannot override an earlier
    // parameter by appending a duplicate.
    if (!(key in params)) {
      params[key] = safeDecode(rawValue);
    }
  }

  return params;
}

/**
 * Percent-decodes a component, falling back to the raw text.
 *
 * `decodeURIComponent` throws on malformed escapes like `%zz`; a deep link is
 * attacker-reachable input, so a bad escape must not take down the app's link
 * handler.
 */
function safeDecode(value: string): string {
  const plus = value.replace(/\+/g, ' ');
  try {
    return decodeURIComponent(plus);
  } catch {
    return plus;
  }
}
