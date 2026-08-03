import { beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * OAuth sign-in from the client. Split from index.test.ts because these tests
 * need `getClientConfig` mocked to simulate a React Native client, while that
 * suite deliberately exercises the unconfigured browser path.
 */

const mockCallMethod = vi.fn();
const mockSetCurrentUser = vi.fn();
const mockGetClientConfig = vi.fn<() => Record<string, unknown> | null>();

vi.doMock('../../client/method', () => ({ callMethod: mockCallMethod }));
vi.doMock('../../client/session', () => ({ setCurrentUser: mockSetCurrentUser }));
vi.doMock('../../client/localStorage', () => ({ getLocalStorageSession: vi.fn() }));
vi.doMock('../../client/clientConfig', () => ({ getClientConfig: mockGetClientConfig }));

const authClient = await import('./index');

Object.defineProperty(globalThis, 'window', {
  value: { location: { href: '' } },
  writable: true,
});

const mockOpenUrl = vi.fn();
const mockSetAuthToken = vi.fn();

/** A React Native style client: token in storage, URLs opened via Linking. */
function useNativeClient() {
  mockGetClientConfig.mockReturnValue({
    baseUrl: 'https://app.example.com',
    openUrl: mockOpenUrl,
    setAuthToken: mockSetAuthToken,
    getAuthToken: () => 'stored-token',
  });
}

describe('auth/client — OAuth sign-in', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.location.href = '';
    mockGetClientConfig.mockReturnValue(null);
  });

  describe('signInWithOAuth', () => {
    test('opens the provider URL with the mobile handoff params', async () => {
      useNativeClient();

      await authClient.signInWithOAuth({ provider: 'google', redirectUri: 'myapp://auth' });

      expect(mockOpenUrl).toHaveBeenCalledTimes(1);
      const url = new URL(mockOpenUrl.mock.calls[0][0] as string);
      expect(url.origin + url.pathname).toBe('https://app.example.com/api/_internal/auth/google');
      expect(url.searchParams.get('mode')).toBe('login');
      expect(url.searchParams.get('platform')).toBe('mobile');
      expect(url.searchParams.get('redirectUri')).toBe('myapp://auth');
    });

    test('encodes a redirectUri containing reserved characters', async () => {
      useNativeClient();

      await authClient.signInWithOAuth({
        provider: 'google',
        redirectUri: 'exp://127.0.0.1:19000/--/auth',
      });

      const url = new URL(mockOpenUrl.mock.calls[0][0] as string);
      expect(url.searchParams.get('redirectUri')).toBe('exp://127.0.0.1:19000/--/auth');
    });

    test('works for github too', async () => {
      useNativeClient();

      await authClient.signInWithOAuth({ provider: 'github', redirectUri: 'myapp://auth' });

      expect(mockOpenUrl.mock.calls[0][0]).toContain('/api/_internal/auth/github');
    });

    // Failing loudly here beats a flow that silently dead-ends in the browser.
    test('throws when a native client omits redirectUri', async () => {
      useNativeClient();

      await expect(authClient.signInWithOAuth({ provider: 'google' })).rejects.toThrow(
        /requires a redirectUri/
      );
      expect(mockOpenUrl).not.toHaveBeenCalled();
    });

    test('navigates the browser with no mobile params when unconfigured', async () => {
      await authClient.signInWithOAuth({ provider: 'google' });

      expect(window.location.href).toBe('/api/_internal/auth/google?mode=login');
      expect(mockOpenUrl).not.toHaveBeenCalled();
    });
  });

  describe('loginWithOAuth', () => {
    beforeEach(() => {
      mockCallMethod.mockResolvedValue({
        user: { id: 'u1', handle: 'user', roles: [] },
        session: { authToken: 'new-token' },
      });
    });

    test('exchanges the code and stores the returned token', async () => {
      useNativeClient();

      await authClient.loginWithOAuth({ code: 'exchange-code' });

      expect(mockCallMethod).toHaveBeenCalledWith('_system.user.loginWithOAuth', {
        code: 'exchange-code',
      });
      expect(mockSetAuthToken).toHaveBeenCalledWith('new-token');
    });

    // This is what closes the useSession gap that previously forced an
    // updateProfile({}) call to refresh the store.
    test('updates the session store so useSession re-renders', async () => {
      useNativeClient();
      mockSetCurrentUser.mockReturnValue({ id: 'u1', handle: 'user' });

      const user = await authClient.loginWithOAuth({ code: 'exchange-code' });

      expect(mockSetCurrentUser).toHaveBeenCalledWith({ id: 'u1', handle: 'user', roles: [] });
      expect(user).toEqual({ id: 'u1', handle: 'user' });
    });

    test('propagates a rejected exchange without storing a token', async () => {
      useNativeClient();
      mockCallMethod.mockRejectedValue(new Error('Invalid or expired sign-in code'));

      await expect(authClient.loginWithOAuth({ code: 'spent' })).rejects.toThrow(
        'Invalid or expired sign-in code'
      );
      expect(mockSetAuthToken).not.toHaveBeenCalled();
    });
  });

  describe('linkOAuthProvider', () => {
    test('adds the mobile handoff params when a redirectUri is given', async () => {
      useNativeClient();
      globalThis.fetch = vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ nonce: 'nonce-value' }), { status: 200 })
        ) as typeof fetch;

      await authClient.linkOAuthProvider({ provider: 'google', redirectUri: 'myapp://auth' });

      const url = new URL(mockOpenUrl.mock.calls[0][0] as string);
      expect(url.searchParams.get('mode')).toBe('link');
      expect(url.searchParams.get('linkNonce')).toBe('nonce-value');
      expect(url.searchParams.get('platform')).toBe('mobile');
      expect(url.searchParams.get('redirectUri')).toBe('myapp://auth');
    });

    test('omits them when no redirectUri is given, preserving existing behaviour', async () => {
      useNativeClient();
      globalThis.fetch = vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ nonce: 'nonce-value' }), { status: 200 })
        ) as typeof fetch;

      await authClient.linkOAuthProvider({ provider: 'google' });

      const url = new URL(mockOpenUrl.mock.calls[0][0] as string);
      expect(url.searchParams.get('platform')).toBeNull();
      expect(url.searchParams.get('redirectUri')).toBeNull();
    });
  });
});
