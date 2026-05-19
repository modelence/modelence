import { describe, test, expect, beforeEach, vi } from 'vitest';

describe('authConfig', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  test('returns a frozen empty config by default', async () => {
    const { getAuthConfig } = await import('./authConfig');

    const config = getAuthConfig();

    expect(config).toEqual({});
    expect(Object.isFrozen(config)).toBe(true);
  });

  test('merges new config properties while preserving previous ones', async () => {
    const { setAuthConfig, getAuthConfig } = await import('./authConfig');

    const onAfterLogin = vi.fn();
    setAuthConfig({ onAfterLogin });

    const onSignupError = vi.fn();
    setAuthConfig({ onSignupError });

    const config = getAuthConfig();

    expect(config).toMatchObject({ onAfterLogin, onSignupError });
    expect(Object.isFrozen(config)).toBe(true);
  });

  test('later updates override existing keys and create a new frozen object', async () => {
    const { setAuthConfig, getAuthConfig } = await import('./authConfig');

    const firstHandler = vi.fn();
    setAuthConfig({ onAfterLogin: firstHandler });
    const previousConfig = getAuthConfig();

    const secondHandler = vi.fn();
    setAuthConfig({ onAfterLogin: secondHandler });

    const updatedConfig = getAuthConfig();

    expect(updatedConfig.onAfterLogin).toBe(secondHandler);
    expect(updatedConfig).not.toBe(previousConfig);
    expect(Object.isFrozen(updatedConfig)).toBe(true);
  });
});
