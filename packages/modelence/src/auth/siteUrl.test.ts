import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mockGetConfig = vi.fn();
vi.doMock('@/config/server', () => ({
  getConfig: mockGetConfig,
}));

const { requireSiteUrl } = await import('./siteUrl');

describe('auth/siteUrl', () => {
  beforeEach(() => {
    mockGetConfig.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test('returns the configured site URL', () => {
    mockGetConfig.mockReturnValue('https://app.example.com');

    expect(requireSiteUrl('reset link')).toBe('https://app.example.com');
    expect(mockGetConfig).toHaveBeenCalledWith('_system.site.url');
  });

  test.each([undefined, '', 42])('throws naming the link when the value is %p', (value) => {
    mockGetConfig.mockReturnValue(value);

    expect(() => requireSiteUrl('reset link')).toThrow(
      'Unable to build reset link: set _system.site.url (MODELENCE_SITE_URL)'
    );
  });

  describe('when the site URL is unset', () => {
    beforeEach(() => {
      mockGetConfig.mockReturnValue(undefined);
      vi.stubEnv('MODELENCE_SITE_URL', undefined);
      vi.stubEnv('MODELENCE_PORT', undefined);
      vi.stubEnv('PORT', undefined);
    });

    test('falls back to the local site URL under the dev server', () => {
      vi.stubEnv('NODE_ENV', 'development');

      expect(requireSiteUrl('reset link')).toBe('http://localhost:3000');
    });

    test('uses the configured port for the local site URL', () => {
      vi.stubEnv('NODE_ENV', 'development');
      vi.stubEnv('MODELENCE_PORT', '4100');

      expect(requireSiteUrl('reset link')).toBe('http://localhost:4100');
    });

    // Unset included: a self-hosted server started without NODE_ENV must fail
    // rather than email its users links to localhost.
    test.each(['production', 'test', undefined])('throws when NODE_ENV is %p', (nodeEnv) => {
      vi.stubEnv('NODE_ENV', nodeEnv);

      expect(() => requireSiteUrl('reset link')).toThrow(/MODELENCE_SITE_URL/);
    });
  });

  test('prefers the configured site URL under the dev server', () => {
    vi.stubEnv('NODE_ENV', 'development');
    mockGetConfig.mockReturnValue('https://app.example.com');

    expect(requireSiteUrl('reset link')).toBe('https://app.example.com');
  });
});
