import { beforeEach, describe, expect, test, vi } from 'vitest';

const mockGetConfig = vi.fn<(key: string) => unknown>();
const mockGetAuthConfig = vi.fn<() => Record<string, unknown>>();

vi.doMock('@/config/server', () => ({
  getConfig: mockGetConfig,
}));

vi.doMock('@/app/authConfig', () => ({
  getAuthConfig: mockGetAuthConfig,
}));

const { getAllowedMobileRedirectUrls, isAllowedMobileRedirectUrl, buildMobileRedirect } =
  await import('./mobileRedirect');

/** Configures both allowlist sources for a single test. */
function setAllowlist({
  config = '',
  authConfig,
}: { config?: string; authConfig?: string[] } = {}) {
  mockGetConfig.mockImplementation((key) =>
    key === '_system.user.auth.mobile.redirectUrls' ? config : undefined
  );
  mockGetAuthConfig.mockReturnValue(authConfig ? { mobile: { redirectUrls: authConfig } } : {});
}

describe('auth/providers/mobileRedirect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setAllowlist();
  });

  describe('getAllowedMobileRedirectUrls', () => {
    test('merges both sources and de-duplicates', () => {
      setAllowlist({
        config: 'myapp://auth, other://cb',
        authConfig: ['myapp://auth', 'third://x'],
      });

      expect(getAllowedMobileRedirectUrls()).toEqual(['myapp://auth', 'other://cb', 'third://x']);
    });

    test('trims whitespace and drops empty entries', () => {
      setAllowlist({ config: '  myapp://auth ,, , other://cb  ' });

      expect(getAllowedMobileRedirectUrls()).toEqual(['myapp://auth', 'other://cb']);
    });

    test('is empty when neither source is configured', () => {
      expect(getAllowedMobileRedirectUrls()).toEqual([]);
    });
  });

  describe('isAllowedMobileRedirectUrl', () => {
    test('accepts an exact match from either source', () => {
      setAllowlist({ config: 'myapp://auth' });
      expect(isAllowedMobileRedirectUrl('myapp://auth')).toBe(true);

      setAllowlist({ authConfig: ['myapp://auth'] });
      expect(isAllowedMobileRedirectUrl('myapp://auth')).toBe(true);
    });

    test('accepts added query parameters and a trailing slash', () => {
      setAllowlist({ config: 'myapp://auth' });

      expect(isAllowedMobileRedirectUrl('myapp://auth?code=abc')).toBe(true);
      expect(isAllowedMobileRedirectUrl('myapp://auth/')).toBe(true);
    });

    test('is case-insensitive on scheme and host', () => {
      setAllowlist({ config: 'myapp://auth' });

      expect(isAllowedMobileRedirectUrl('MYAPP://AUTH')).toBe(true);
    });

    // The core reason this is a URL comparison rather than a string prefix test.
    test('rejects a host that merely starts with an allowed host', () => {
      setAllowlist({ config: 'myapp://auth' });

      expect(isAllowedMobileRedirectUrl('myapp://authorize.evil')).toBe(false);
      expect(isAllowedMobileRedirectUrl('myapp://auth.evil.com')).toBe(false);
    });

    test('rejects a different path, host or scheme', () => {
      setAllowlist({ config: 'myapp://auth' });

      expect(isAllowedMobileRedirectUrl('myapp://auth/callback')).toBe(false);
      expect(isAllowedMobileRedirectUrl('myapp://other')).toBe(false);
      expect(isAllowedMobileRedirectUrl('evilapp://auth')).toBe(false);
      expect(isAllowedMobileRedirectUrl('https://auth')).toBe(false);
    });

    // `myapp://evil@auth` parses to the host `auth`, so it would otherwise match
    // an allowlisted `myapp://auth` while redirecting somewhere that reads
    // differently to the OS handling the deep link.
    test('rejects a candidate carrying userinfo', () => {
      setAllowlist({ config: 'myapp://auth' });

      expect(isAllowedMobileRedirectUrl('myapp://evil@auth')).toBe(false);
      expect(isAllowedMobileRedirectUrl('myapp://evil:secret@auth')).toBe(false);
    });

    test('rejects an allowlist entry carrying userinfo', () => {
      setAllowlist({ config: 'myapp://evil@auth' });

      expect(isAllowedMobileRedirectUrl('myapp://evil@auth')).toBe(false);
      expect(isAllowedMobileRedirectUrl('myapp://auth')).toBe(false);
    });

    // Host and path are separate fields, so the opaque and authority spellings of
    // a custom scheme are different targets. Pinned so the exact-match semantics
    // are not silently loosened into normalization later.
    test('treats the opaque and authority forms as distinct targets', () => {
      setAllowlist({ config: 'myapp://auth' });

      expect(isAllowedMobileRedirectUrl('myapp://auth')).toBe(true);
      expect(isAllowedMobileRedirectUrl('myapp:auth')).toBe(false);
      expect(isAllowedMobileRedirectUrl('myapp:/auth')).toBe(false);
    });

    test('matches the opaque form only against an opaque allowlist entry', () => {
      setAllowlist({ config: 'myapp:auth' });

      expect(isAllowedMobileRedirectUrl('myapp:auth')).toBe(true);
      expect(isAllowedMobileRedirectUrl('myapp://auth')).toBe(false);
    });

    test('rejects dangerous schemes even if somehow allowlisted', () => {
      setAllowlist({ config: 'javascript:alert(1), data:text/html;base64:x, file:///etc/passwd' });

      expect(isAllowedMobileRedirectUrl('javascript:alert(1)')).toBe(false);
      expect(isAllowedMobileRedirectUrl('data:text/html;base64:x')).toBe(false);
      expect(isAllowedMobileRedirectUrl('file:///etc/passwd')).toBe(false);
    });

    test('rejects unparseable and empty input', () => {
      setAllowlist({ config: 'myapp://auth' });

      expect(isAllowedMobileRedirectUrl('not a url')).toBe(false);
      expect(isAllowedMobileRedirectUrl('')).toBe(false);
      expect(isAllowedMobileRedirectUrl(undefined as unknown as string)).toBe(false);
    });

    // Fail closed: an unconfigured app must not accidentally allow deep links.
    test('rejects everything when the allowlist is empty', () => {
      expect(isAllowedMobileRedirectUrl('myapp://auth')).toBe(false);
    });

    test('supports Expo-style http(s) deep links with ports and paths', () => {
      setAllowlist({ config: 'exp://127.0.0.1:19000/--/auth' });

      expect(isAllowedMobileRedirectUrl('exp://127.0.0.1:19000/--/auth')).toBe(true);
      expect(isAllowedMobileRedirectUrl('exp://127.0.0.1:19001/--/auth')).toBe(false);
      expect(isAllowedMobileRedirectUrl('exp://127.0.0.1:19000/--/evil')).toBe(false);
    });
  });

  describe('buildMobileRedirect', () => {
    test('appends parameters while preserving the target', () => {
      expect(buildMobileRedirect('myapp://auth', { code: 'abc' })).toBe('myapp://auth?code=abc');
    });

    test('encodes parameter values', () => {
      const url = buildMobileRedirect('myapp://auth', { error: 'Not allowed: try again' });

      expect(new URL(url).searchParams.get('error')).toBe('Not allowed: try again');
    });

    test('overwrites an existing parameter of the same name', () => {
      const url = buildMobileRedirect('myapp://auth?code=stale', { code: 'fresh' });

      expect(new URL(url).searchParams.getAll('code')).toEqual(['fresh']);
    });
  });
  /**
   * The allowlist matches scheme, host and path only, so a configured target may
   * legitimately carry query parameters — including one this module owns. A
   * `redirectUri` of `myapp://auth?error=...` passes the allowlist, and without
   * this reset a successful sign-in would deep-link back still carrying it and
   * read as failed to the app.
   */
  describe('outcome parameters are reset, never inherited', () => {
    test('drops a pre-existing error on the success path', () => {
      const result = buildMobileRedirect('myapp://auth?error=stale', { code: 'abc' });

      expect(result).not.toContain('error=stale');
      expect(new URL(result).searchParams.get('code')).toBe('abc');
      expect(new URL(result).searchParams.get('error')).toBeNull();
    });

    test('drops a pre-existing code on the error path', () => {
      const result = buildMobileRedirect('myapp://auth?code=stale', { error: 'Nope' });

      expect(new URL(result).searchParams.get('code')).toBeNull();
      expect(new URL(result).searchParams.get('error')).toBe('Nope');
    });

    test('drops a stale linked marker', () => {
      const result = buildMobileRedirect('myapp://auth?linked=github', { code: 'abc' });

      expect(new URL(result).searchParams.get('linked')).toBeNull();
    });

    // Only the parameters this module owns are touched; the app's own state
    // survives the round trip.
    test('preserves unrelated parameters the app put there', () => {
      const result = buildMobileRedirect('myapp://auth?returnTo=%2Fsettings', { code: 'abc' });

      expect(new URL(result).searchParams.get('returnTo')).toBe('/settings');
      expect(new URL(result).searchParams.get('code')).toBe('abc');
    });
  });
});
