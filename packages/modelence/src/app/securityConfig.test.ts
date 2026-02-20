import { describe, expect, test, beforeEach, jest } from '@jest/globals';

describe('securityConfig', () => {
  beforeEach(() => {
    jest.resetModules();
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
