import { describe, expect, test, beforeEach, vi } from 'vitest';

describe('securityConfig', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  test('returns a frozen empty config by default', async () => {
    const { getSecurityConfig } = await import('./securityConfig');

    const config = getSecurityConfig();

    expect(config).toEqual({});
    expect(Object.isFrozen(config)).toBe(true);
  });

  test('sets and retrieves frameAncestors', async () => {
    const { setSecurityConfig, getSecurityConfig } = await import('./securityConfig');

    setSecurityConfig({ frameAncestors: ['https://modelence.com'] });

    expect(getSecurityConfig().frameAncestors).toEqual(['https://modelence.com']);
  });

  test('config is frozen after setting', async () => {
    const { setSecurityConfig, getSecurityConfig } = await import('./securityConfig');

    setSecurityConfig({ frameAncestors: ['https://example.com'] });
    const config = getSecurityConfig();

    expect(Object.isFrozen(config)).toBe(true);
  });

  test('later updates override existing keys and create a new frozen object', async () => {
    const { setSecurityConfig, getSecurityConfig } = await import('./securityConfig');

    setSecurityConfig({ frameAncestors: ['https://example.com'] });
    const previousConfig = getSecurityConfig();

    setSecurityConfig({ frameAncestors: ['https://other.com'] });
    const updatedConfig = getSecurityConfig();

    expect(updatedConfig.frameAncestors).toEqual(['https://other.com']);
    expect(updatedConfig).not.toBe(previousConfig);
    expect(Object.isFrozen(updatedConfig)).toBe(true);
  });

  test('sets and retrieves allowedOrigins', async () => {
    const { setSecurityConfig, getSecurityConfig } = await import('./securityConfig');

    setSecurityConfig({ allowedOrigins: ['http://localhost:8081'] });

    expect(getSecurityConfig().allowedOrigins).toEqual(['http://localhost:8081']);
  });

  test('normalizes allowedOrigins to the form browsers send', async () => {
    const { setSecurityConfig, getSecurityConfig } = await import('./securityConfig');

    // Each of these silently never matched before normalization, surfacing to
    // the developer only as a generic CORS error in the browser.
    setSecurityConfig({
      allowedOrigins: [
        '  http://localhost:8081  ',
        'http://LOCALHOST:8082',
        'https://example.com/',
        'https://example.org:443',
        'http://example.net:80',
      ],
    });

    expect(getSecurityConfig().allowedOrigins).toEqual([
      'http://localhost:8081',
      'http://localhost:8082',
      'https://example.com',
      'https://example.org',
      'http://example.net',
    ]);
  });

  test('rejects a wildcard origin', async () => {
    const { setSecurityConfig } = await import('./securityConfig');

    expect(() => setSecurityConfig({ allowedOrigins: ['*'] })).toThrow(
      /wildcards are not supported/
    );
  });

  test('rejects an origin that includes a path', async () => {
    const { setSecurityConfig } = await import('./securityConfig');

    expect(() => setSecurityConfig({ allowedOrigins: ['http://localhost:8081/api'] })).toThrow(
      /must not include a path/
    );
  });

  test('rejects a value that is not a URL', async () => {
    const { setSecurityConfig } = await import('./securityConfig');

    expect(() => setSecurityConfig({ allowedOrigins: ['localhost:8081'] })).toThrow(
      /scheme:\/\/host/
    );
    expect(() => setSecurityConfig({ allowedOrigins: [''] })).toThrow(/non-empty string/);
  });

  test('rejects a scheme that has no comparable origin', async () => {
    const { setSecurityConfig } = await import('./securityConfig');

    // These serialize to 'null', which would match the opaque origin a
    // sandboxed iframe sends.
    expect(() => setSecurityConfig({ allowedOrigins: ['data:text/html,hi'] })).toThrow(
      /does not form a comparable origin/
    );
    // A missing scheme parses as an opaque `localhost:` URL, so it lands here
    // too — the message must still point at the scheme://host form.
    expect(() => setSecurityConfig({ allowedOrigins: ['localhost:8081'] })).toThrow(
      /does not form a comparable origin/
    );
  });

  test('rejects an origin carrying credentials, query, or fragment', async () => {
    const { setSecurityConfig } = await import('./securityConfig');

    expect(() => setSecurityConfig({ allowedOrigins: ['http://user:pw@example.com'] })).toThrow(
      /must not carry credentials/
    );
    expect(() => setSecurityConfig({ allowedOrigins: ['http://example.com/?a=1'] })).toThrow(
      /must not carry a query or fragment/
    );
  });

  test('leaves config unchanged when validation fails', async () => {
    const { setSecurityConfig, getSecurityConfig } = await import('./securityConfig');

    setSecurityConfig({ allowedOrigins: ['http://localhost:8081'] });
    expect(() => setSecurityConfig({ allowedOrigins: ['*'] })).toThrow();

    expect(getSecurityConfig().allowedOrigins).toEqual(['http://localhost:8081']);
  });

  test('allowedOrigins is undefined by default', async () => {
    const { getSecurityConfig } = await import('./securityConfig');

    expect(getSecurityConfig().allowedOrigins).toBeUndefined();
  });

  test('frameAncestors and allowedOrigins are independent', async () => {
    const { setSecurityConfig, getSecurityConfig } = await import('./securityConfig');

    setSecurityConfig({ frameAncestors: ['https://modelence.com'] });
    setSecurityConfig({ allowedOrigins: ['http://localhost:8081'] });

    const config = getSecurityConfig();
    expect(config.frameAncestors).toEqual(['https://modelence.com']);
    expect(config.allowedOrigins).toEqual(['http://localhost:8081']);
  });

  test('supports multiple frame ancestors', async () => {
    const { setSecurityConfig, getSecurityConfig } = await import('./securityConfig');

    setSecurityConfig({
      frameAncestors: ['https://modelence.com', 'https://app.modelence.com'],
    });

    expect(getSecurityConfig().frameAncestors).toEqual([
      'https://modelence.com',
      'https://app.modelence.com',
    ]);
  });
});
