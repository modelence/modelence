import { describe, expect, test } from '@jest/globals';

describe('client', () => {
  test('should export getConfig', async () => {
    const { getConfig } = await import('./client');
    expect(typeof getConfig).toBe('function');
  });

  test('should export AppProvider', async () => {
    const { AppProvider } = await import('./client');
    expect(AppProvider).toBeDefined();
  });

  test('should export renderApp', async () => {
    const { renderApp } = await import('./client');
    expect(typeof renderApp).toBe('function');
  });

  test('should export callMethod', async () => {
    const { callMethod } = await import('./client');
    expect(typeof callMethod).toBe('function');
  });

  test('should export useSession', async () => {
    const { useSession } = await import('./client');
    expect(typeof useSession).toBe('function');
  });

  test('should export auth functions', async () => {
    const {
      signupWithPassword,
      loginWithPassword,
      verifyEmail,
      logout,
      sendResetPasswordToken,
      resetPassword,
    } = await import('./client');

    expect(typeof signupWithPassword).toBe('function');
    expect(typeof loginWithPassword).toBe('function');
    expect(typeof verifyEmail).toBe('function');
    expect(typeof logout).toBe('function');
    expect(typeof sendResetPasswordToken).toBe('function');
    expect(typeof resetPassword).toBe('function');
  });

  test('should export websocket functions', async () => {
    const {
      getWebsocketClientProvider,
      setWebsocketClientProvider,
      startWebsockets,
    } = await import('./client');

    expect(typeof getWebsocketClientProvider).toBe('function');
    expect(typeof setWebsocketClientProvider).toBe('function');
    expect(typeof startWebsockets).toBe('function');
  });

  test('should export ClientChannel', async () => {
    const { ClientChannel } = await import('./client');
    expect(typeof ClientChannel).toBe('function');
  });

  test('should export getLocalStorageSession', async () => {
    const { getLocalStorageSession } = await import('./client');
    expect(typeof getLocalStorageSession).toBe('function');
  });

  test('should have all expected exports', async () => {
    const exports = await import('./client');
    const exportedKeys = Object.keys(exports);

    const expectedExports = [
      'getConfig',
      'AppProvider',
      'renderApp',
      'callMethod',
      'useSession',
      'signupWithPassword',
      'loginWithPassword',
      'verifyEmail',
      'logout',
      'sendResetPasswordToken',
      'resetPassword',
      'getWebsocketClientProvider',
      'setWebsocketClientProvider',
      'startWebsockets',
      'ClientChannel',
      'getLocalStorageSession',
    ];

    expectedExports.forEach((expectedExport) => {
      expect(exportedKeys).toContain(expectedExport);
    });
  });
});
