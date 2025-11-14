import { describe, test, expect, beforeEach, jest } from '@jest/globals';

describe('authConfig', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test('returns a frozen empty config by default', async () => {
    const { getAuthConfig } = await import('./authConfig');

    const config = getAuthConfig();

    expect(config).toEqual({});
    expect(Object.isFrozen(config)).toBe(true);
  });

  test('merges new config properties while preserving previous ones', async () => {
    const { setAuthConfig, getAuthConfig } = await import('./authConfig');

    const onAfterLogin = jest.fn();
    setAuthConfig({ onAfterLogin });

    const onSignupError = jest.fn();
    setAuthConfig({ onSignupError });

    const config = getAuthConfig();

    expect(config).toMatchObject({ onAfterLogin, onSignupError });
    expect(Object.isFrozen(config)).toBe(true);
  });

  test('later updates override existing keys and create a new frozen object', async () => {
    const { setAuthConfig, getAuthConfig } = await import('./authConfig');

    const firstHandler = jest.fn();
    setAuthConfig({ onAfterLogin: firstHandler });
    const previousConfig = getAuthConfig();

    const secondHandler = jest.fn();
    setAuthConfig({ onAfterLogin: secondHandler });

    const updatedConfig = getAuthConfig();

    expect(updatedConfig.onAfterLogin).toBe(secondHandler);
    expect(updatedConfig).not.toBe(previousConfig);
    expect(Object.isFrozen(updatedConfig)).toBe(true);
  });
});
