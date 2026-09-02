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
const { resetOAuthVerifier } = await import('./oauthVerifier');

Object.defineProperty(globalThis, 'window', {
  value: { location: { href: '' } },
  writable: true,
});

const mockOpenUrl = vi.fn();
const mockSetAuthToken = vi.fn();

/**
 * Replaces `window` with one that has a message bus, standing in for a page
 * at https://app.example.com — the iframe when `opener` is omitted, the popup
 * when it is given.
 */
function usePopupWindow(opener?: unknown) {
  const listeners = new Set<(event: MessageEvent) => void>();
  const win = {
    location: { href: '', origin: 'https://app.example.com' },
    opener,
    addEventListener: vi.fn((_type: string, listener: (event: MessageEvent) => void) => {
      listeners.add(listener);
    }),
    removeEventListener: vi.fn((_type: string, listener: (event: MessageEvent) => void) => {
      listeners.delete(listener);
    }),
    deliver: (event: { source: unknown; origin: string; data: unknown }) => {
      for (const listener of [...listeners]) listener(event as unknown as MessageEvent);
    },
  };
  (globalThis as { window: unknown }).window = win;
  return win;
}

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
    mockOpenUrl.mockReset();
    (globalThis as { window: unknown }).window = { location: { href: '' } };
    mockGetClientConfig.mockReturnValue(null);
    // The verifier is module-scoped, so a flow started by one test would
    // otherwise be redeemable by the next.
    resetOAuthVerifier();
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

    // `redirectUri` — not `openUrl` — selects the native flow, so an Electron or
    // Capacitor client that sets openUrl purely to control link opening still
    // completes the ordinary cookie-based web flow.
    test('runs the web flow when a client with openUrl omits redirectUri', async () => {
      useNativeClient();

      await authClient.signInWithOAuth({ provider: 'google' });

      expect(mockOpenUrl).toHaveBeenCalledTimes(1);
      const url = new URL(mockOpenUrl.mock.calls[0][0] as string);
      expect(url.searchParams.get('platform')).toBeNull();
      expect(url.searchParams.get('codeChallenge')).toBeNull();
    });

    // A redirectUri asks for the native flow, which cannot work without a way
    // to open the device browser.
    test('throws when a redirectUri is given but the client cannot open URLs', async () => {
      await expect(
        authClient.signInWithOAuth({ provider: 'google', redirectUri: 'myapp://auth' })
      ).rejects.toThrow(/openUrl/);
    });

    // The device binding that makes an intercepted code useless.
    test('sends a code challenge with the mobile handoff', async () => {
      useNativeClient();

      await authClient.signInWithOAuth({ provider: 'google', redirectUri: 'myapp://auth' });

      const url = new URL(mockOpenUrl.mock.calls[0][0] as string);
      expect(url.searchParams.get('codeChallenge')).toMatch(/^[0-9a-f]{64}$/);
    });

    test('navigates the browser with no mobile params when unconfigured', async () => {
      await authClient.signInWithOAuth({ provider: 'google' });

      expect(window.location.href).toBe('/api/_internal/auth/google?mode=login');
      expect(mockOpenUrl).not.toHaveBeenCalled();
    });

    /**
     * The iframe case: the app cannot navigate in place (providers refuse to
     * render inside an iframe) so `openUrl` opens a popup and returns it. The
     * popup's storage is partitioned away from the iframe's, so the verifier
     * has to travel over postMessage — and only to that popup.
     */
    describe('when openUrl returns the popup it opened', () => {
      test('registers a message listener for the popup', async () => {
        const popup = { postMessage: vi.fn() };
        useNativeClient();
        mockOpenUrl.mockReturnValue(popup);
        usePopupWindow();

        await authClient.signInWithOAuth({
          provider: 'google',
          redirectUri: 'https://app.example.com/auth',
        });

        expect(window.addEventListener).toHaveBeenCalledWith('message', expect.any(Function));
      });

      test('serves the verifier to that popup once, and then it is spent', async () => {
        const popup = { postMessage: vi.fn() };
        useNativeClient();
        mockOpenUrl.mockReturnValue(popup);
        const win = usePopupWindow();

        await authClient.signInWithOAuth({
          provider: 'google',
          redirectUri: 'https://app.example.com/auth',
        });
        const challenge = new URL(mockOpenUrl.mock.calls[0][0] as string).searchParams.get(
          'codeChallenge'
        );

        win.deliver({
          source: popup,
          origin: 'https://app.example.com',
          data: { type: 'modelence:oauth-verifier-request', nonce: 'n' },
        });

        expect(popup.postMessage).toHaveBeenCalledWith(
          { type: 'modelence:oauth-verifier-reply', nonce: 'n', verifier: challenge },
          'https://app.example.com'
        );
        // Handed over: this page can no longer redeem it either.
        await expect(authClient.loginWithOAuth({ code: 'c' })).rejects.toThrow(/sign in again/i);
      });

      test('does not serve the verifier to any other window', async () => {
        const popup = { postMessage: vi.fn() };
        const probe = { postMessage: vi.fn() };
        useNativeClient();
        mockOpenUrl.mockReturnValue(popup);
        const win = usePopupWindow();

        await authClient.signInWithOAuth({
          provider: 'google',
          redirectUri: 'https://app.example.com/auth',
        });
        win.deliver({
          source: probe,
          origin: 'https://app.example.com',
          data: { type: 'modelence:oauth-verifier-request', nonce: 'n' },
        });

        expect(popup.postMessage).not.toHaveBeenCalled();
        expect(probe.postMessage).not.toHaveBeenCalled();
      });

      // Linking.openURL returns a Promise, which is not a window: the native
      // path must not start listening for anything.
      test('ignores a Promise returned by openUrl', async () => {
        useNativeClient();
        mockOpenUrl.mockReturnValue(Promise.resolve());
        usePopupWindow();

        await authClient.signInWithOAuth({ provider: 'google', redirectUri: 'myapp://auth' });

        expect(window.addEventListener).not.toHaveBeenCalled();
      });
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
      await authClient.signInWithOAuth({ provider: 'google', redirectUri: 'myapp://auth' });
      const challenge = new URL(mockOpenUrl.mock.calls[0][0] as string).searchParams.get(
        'codeChallenge'
      );

      await authClient.loginWithOAuth({ code: 'exchange-code' });

      expect(mockCallMethod).toHaveBeenCalledWith('_system.user.loginWithOAuth', {
        code: 'exchange-code',
        codeVerifier: challenge,
      });
      expect(mockSetAuthToken).toHaveBeenCalledWith('new-token');
    });

    // Without this, a crafted myapp://auth?code=... handed to the device would
    // redeem an attacker's code against the victim's session.
    test('refuses a code when no sign-in was started on this device', async () => {
      useNativeClient();

      await expect(authClient.loginWithOAuth({ code: 'attacker-code' })).rejects.toThrow(
        /sign in again/i
      );
      expect(mockCallMethod).not.toHaveBeenCalled();
    });

    // Apps surface this mid-flow error in their UI, so the thrown message must
    // read as end-user copy; the integration cause goes to the console instead.
    test('throws user-facing copy and logs the developer cause separately', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

      await expect(authClient.loginWithOAuth({ code: 'any-code' })).rejects.toThrow(
        'This sign-in link is no longer valid. Please sign in again.'
      );

      // No API names or integration instructions in what the user sees.
      const message = await authClient
        .loginWithOAuth({ code: 'any-code' })
        .catch((err: Error) => err.message);
      expect(message).not.toMatch(/loginWithOAuth|signInWithOAuth|verifier/);

      expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('no sign-in in progress'));
      consoleError.mockRestore();
    });

    // The verifier is single-use, so a deep link firing twice cannot replay it.
    test('does not reuse the verifier for a second redemption', async () => {
      useNativeClient();
      await authClient.signInWithOAuth({ provider: 'google', redirectUri: 'myapp://auth' });

      await authClient.loginWithOAuth({ code: 'exchange-code' });

      await expect(authClient.loginWithOAuth({ code: 'exchange-code' })).rejects.toThrow(
        /sign in again/i
      );
    });

    // This is what closes the useSession gap that previously forced an
    // updateProfile({}) call to refresh the store.
    test('updates the session store so useSession re-renders', async () => {
      useNativeClient();
      await authClient.signInWithOAuth({ provider: 'google', redirectUri: 'myapp://auth' });
      mockSetCurrentUser.mockReturnValue({ id: 'u1', handle: 'user' });

      const user = await authClient.loginWithOAuth({ code: 'exchange-code' });

      expect(mockSetCurrentUser).toHaveBeenCalledWith({ id: 'u1', handle: 'user', roles: [] });
      expect(user).toEqual({ id: 'u1', handle: 'user' });
    });

    // The popup side of the iframe case: this page was opened by the one that
    // started the flow, so it asks that page rather than its own storage.
    test('obtains the verifier from the opener when opened as a popup', async () => {
      useNativeClient();
      const opener = { postMessage: vi.fn() };
      const win = usePopupWindow(opener);
      opener.postMessage.mockImplementation((message: { nonce: string }) => {
        win.deliver({
          source: opener,
          origin: 'https://app.example.com',
          data: {
            type: 'modelence:oauth-verifier-reply',
            nonce: message.nonce,
            verifier: 'verifier-from-opener',
          },
        });
      });

      await authClient.loginWithOAuth({ code: 'exchange-code' });

      expect(opener.postMessage).toHaveBeenCalledWith(
        { type: 'modelence:oauth-verifier-request', nonce: expect.any(String) },
        'https://app.example.com'
      );
      expect(mockCallMethod).toHaveBeenCalledWith('_system.user.loginWithOAuth', {
        code: 'exchange-code',
        codeVerifier: 'verifier-from-opener',
      });
    });

    // An opener that is not a Modelence page never answers; the ordinary
    // storage path still applies, so nothing regresses for a same-tab flow
    // that happens to have an opener.
    test('falls back to its own verifier when the opener does not answer', async () => {
      vi.useFakeTimers();
      try {
        useNativeClient();
        await authClient.signInWithOAuth({ provider: 'google', redirectUri: 'myapp://auth' });
        const challenge = new URL(mockOpenUrl.mock.calls[0][0] as string).searchParams.get(
          'codeChallenge'
        );
        usePopupWindow({ postMessage: vi.fn() });

        const pending = authClient.loginWithOAuth({ code: 'exchange-code' });
        await vi.advanceTimersByTimeAsync(3000);
        await pending;

        expect(mockCallMethod).toHaveBeenCalledWith('_system.user.loginWithOAuth', {
          code: 'exchange-code',
          codeVerifier: challenge,
        });
      } finally {
        vi.useRealTimers();
      }
    });

    test('propagates a rejected exchange without storing a token', async () => {
      useNativeClient();
      await authClient.signInWithOAuth({ provider: 'google', redirectUri: 'myapp://auth' });
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

    /**
     * Intentionally diverges from signInWithOAuth, which routes its web URL
     * through openUrl. This path authenticates with the httpOnly oauthLinkToken
     * cookie just set on this origin, so it must stay in the same cookie jar —
     * openUrl would hand it to a system browser that never received the cookie.
     */
    test('does not route the browser path through openUrl', async () => {
      useNativeClient();
      globalThis.fetch = vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ ok: true }), { status: 200 })
        ) as typeof fetch;

      await authClient.linkOAuthProvider({ provider: 'google' });

      expect(mockOpenUrl).not.toHaveBeenCalled();
      expect(window.location.href).toContain('mode=link');
    });

    // Without a redirectUri there is no deep link to come back to, so linking
    // takes the browser path — same rule as signInWithOAuth.
    test('takes the browser path when no redirectUri is given', async () => {
      useNativeClient();
      globalThis.fetch = vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ nonce: 'nonce-value' }), { status: 200 })
        ) as typeof fetch;

      await authClient.linkOAuthProvider({ provider: 'google' });

      expect(mockOpenUrl).not.toHaveBeenCalled();
      expect(window.location.href).toContain('mode=link');
    });
  });
});
