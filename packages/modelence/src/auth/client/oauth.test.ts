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
function usePopupWindow(opener: unknown = null, name = '') {
  const listeners = new Set<(event: MessageEvent) => void>();
  const win = {
    location: { href: '', origin: 'https://app.example.com' },
    // Browsers report `null`, not `undefined`, on a page that was never a
    // popup — so the fake does too, or the severed-opener check looks correct
    // while misfiring on every ordinary page.
    opener,
    name,
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
     * popup's storage is partitioned away from the iframe's, so the *code*
     * travels back over postMessage and the sign-in completes here — in the
     * context that actually needs the session. The verifier never leaves.
     */
    describe('when openUrl returns the popup it opened', () => {
      test('redeems the code the popup hands back, using the verifier held here', async () => {
        const popup = { postMessage: vi.fn(), close: vi.fn() };
        useNativeClient();
        mockOpenUrl.mockReturnValue(popup);
        mockCallMethod.mockResolvedValue({
          user: { id: 'u1', handle: 'user', roles: [] },
          session: { authToken: 'new-token' },
        });
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
          data: { type: 'modelence:oauth-code', code: 'code-from-popup' },
        });
        await vi.waitFor(() => expect(mockCallMethod).toHaveBeenCalled());

        // Redeemed here, pairing the popup's code with this page's verifier.
        expect(mockCallMethod).toHaveBeenCalledWith('_system.user.loginWithOAuth', {
          code: 'code-from-popup',
          codeVerifier: challenge,
        });
        // The session lands in THIS context, which is the whole point.
        expect(mockSetAuthToken).toHaveBeenCalledWith('new-token');
        // Acknowledged and dismissed; the verifier was never posted anywhere.
        expect(popup.postMessage).toHaveBeenCalledWith(
          { type: 'modelence:oauth-code-ack', accepted: true },
          'https://app.example.com'
        );
        expect(JSON.stringify(popup.postMessage.mock.calls)).not.toContain(challenge);
        await vi.waitFor(() => expect(popup.close).toHaveBeenCalled());
      });

      // Spent on arrival: a code replayed after the first one has been
      // redeemed finds no verifier here and cannot be exchanged again.
      test('stops listening once a code has been redeemed', async () => {
        const popup = { postMessage: vi.fn(), close: vi.fn() };
        useNativeClient();
        mockOpenUrl.mockReturnValue(popup);
        const win = usePopupWindow();

        await authClient.signInWithOAuth({
          provider: 'google',
          redirectUri: 'https://app.example.com/auth',
        });

        win.deliver({
          source: popup,
          origin: 'https://app.example.com',
          data: { type: 'modelence:oauth-code', code: 'code-from-popup' },
        });
        await vi.waitFor(() => expect(mockCallMethod).toHaveBeenCalledTimes(1));

        win.deliver({
          source: popup,
          origin: 'https://app.example.com',
          data: { type: 'modelence:oauth-code', code: 'code-from-popup' },
        });
        await Promise.resolve();

        expect(mockCallMethod).toHaveBeenCalledTimes(1);
      });

      // Without this marker the callback page cannot tell a COOP-severed
      // opener from an ordinary tab, since both report opener === null.
      test('names the popup so its callback page can identify it', async () => {
        const popup = { postMessage: vi.fn(), close: vi.fn(), name: '' };
        useNativeClient();
        mockOpenUrl.mockReturnValue(popup);
        usePopupWindow();

        await authClient.signInWithOAuth({
          provider: 'google',
          redirectUri: 'https://app.example.com/auth',
        });

        expect(popup.name).toBe('modelence-oauth');
      });

      // A popup that vanished before the name could be assigned must not take
      // the sign-in down with it — only the diagnostic depends on it.
      test('still arms the handoff when naming the popup throws', async () => {
        const popup = {
          postMessage: vi.fn(),
          close: vi.fn(),
          set name(_v: string) {
            throw new Error('detached');
          },
        };
        useNativeClient();
        mockOpenUrl.mockReturnValue(popup);
        mockCallMethod.mockResolvedValue({
          user: { id: 'u1', handle: 'user', roles: [] },
          session: { authToken: 'new-token' },
        });
        const win = usePopupWindow();

        await expect(
          authClient.signInWithOAuth({
            provider: 'google',
            redirectUri: 'https://app.example.com/auth',
          })
        ).resolves.toBeUndefined();

        win.deliver({
          source: popup,
          origin: 'https://app.example.com',
          data: { type: 'modelence:oauth-code', code: 'code-from-popup' },
        });
        await vi.waitFor(() => expect(mockCallMethod).toHaveBeenCalled());
      });

      // A blocked popup returns null from window.open, which previously left
      // signInWithOAuth resolving normally with nothing happening at all.
      test('throws when the browser blocked the popup', async () => {
        useNativeClient();
        mockOpenUrl.mockReturnValue(null);
        usePopupWindow();

        await expect(
          authClient.signInWithOAuth({
            provider: 'google',
            redirectUri: 'https://app.example.com/auth',
          })
        ).rejects.toThrow(/blocked it/i);
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

    // The popup side of the iframe case: this page has no verifier of its own,
    // so it hands the code to the page that opened it and signs in nobody here.
    test('hands the code to the opener when opened as a popup', async () => {
      useNativeClient();
      const opener = { postMessage: vi.fn() };
      const win = usePopupWindow(opener);
      opener.postMessage.mockImplementation(() => {
        win.deliver({
          source: opener,
          origin: 'https://app.example.com',
          data: { type: 'modelence:oauth-code-ack', accepted: true },
        });
      });

      const user = await authClient.loginWithOAuth({ code: 'exchange-code' });

      expect(opener.postMessage).toHaveBeenCalledWith(
        { type: 'modelence:oauth-code', code: 'exchange-code' },
        'https://app.example.com'
      );
      // Redeemed by the opener, not here: no exchange and no token in this
      // context, and nothing to return to the caller.
      expect(mockCallMethod).not.toHaveBeenCalled();
      expect(mockSetAuthToken).not.toHaveBeenCalled();
      expect(user).toBeNull();
    });

    // An opener that declines (or, in the real COOP case, never answers at
    // all) must not strand the flow: this page tries to finish it itself.
    test('falls back to redeeming here when the opener declines', async () => {
      useNativeClient();
      const opener = { postMessage: vi.fn() };
      const win = usePopupWindow(opener);
      opener.postMessage.mockImplementation(() => {
        win.deliver({
          source: opener,
          origin: 'https://app.example.com',
          data: { type: 'modelence:oauth-code-ack', accepted: false },
        });
      });

      // No verifier in this context either, so it fails — but with the
      // diagnostic, rather than hanging or silently doing nothing.
      await expect(authClient.loginWithOAuth({ code: 'exchange-code' })).rejects.toThrow(
        /sign in again/i
      );
    });

    // A page that has its own verifier never asks its opener, so a flow that
    // happens to have an unrelated opener neither waits for it nor regresses.
    test('uses its own verifier without asking the opener when it has one', async () => {
      useNativeClient();
      await authClient.signInWithOAuth({ provider: 'google', redirectUri: 'myapp://auth' });
      const challenge = new URL(mockOpenUrl.mock.calls[0][0] as string).searchParams.get(
        'codeChallenge'
      );
      const opener = { postMessage: vi.fn() };
      usePopupWindow(opener);

      await authClient.loginWithOAuth({ code: 'exchange-code' });

      expect(opener.postMessage).not.toHaveBeenCalled();
      expect(mockCallMethod).toHaveBeenCalledWith('_system.user.loginWithOAuth', {
        code: 'exchange-code',
        codeVerifier: challenge,
      });
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

  /**
   * The diagnostic logged when there is no verifier. It has to name every
   * cause, because none of them are distinguishable from inside the callback
   * page: a COOP `same-origin` hop clears `window.name` and `window.opener`
   * together, `history.length` grows identically for a same-tab redirect, and
   * an ordinary page reports `opener === null` too. An earlier attempt to guess
   * which cause applied misreported the common case, so the message covers all
   * of them instead of picking one.
   */
  describe('loginWithOAuth diagnostics', () => {
    let consoleError: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    function loggedText() {
      return consoleError.mock.calls.map((call) => String(call[0])).join('\n');
    }

    test('names both the missing-flow and the COOP cause', async () => {
      useNativeClient();
      usePopupWindow(null);

      await expect(authClient.loginWithOAuth({ code: 'stray-code' })).rejects.toThrow(
        /sign in again/i
      );

      const logged = loggedText();
      expect(logged).toContain('no sign-in in progress');
      expect(logged).toContain('Cross-Origin-Opener-Policy');
    });

    // Same message regardless of ambient window state, since that state cannot
    // tell the causes apart.
    test('logs the same guidance for a page that was never a popup', async () => {
      useNativeClient();
      usePopupWindow(null, '');

      await expect(authClient.loginWithOAuth({ code: 'stray-code' })).rejects.toThrow(
        /sign in again/i
      );

      expect(loggedText()).toContain('no sign-in in progress');
    });
  });

  /**
   * An embedded preview that reloads while the popup is still at the provider
   * loses the in-memory listener. The verifier survives in sessionStorage, so
   * the flow can be picked up again rather than failing with a misleading
   * "no longer valid".
   */
  describe('resumeOAuthPopup', () => {
    test('re-arms the handoff when a sign-in is still pending', async () => {
      const popup = { postMessage: vi.fn(), close: vi.fn() };
      useNativeClient();
      mockOpenUrl.mockReturnValue(undefined);
      mockCallMethod.mockResolvedValue({
        user: { id: 'u1', handle: 'user', roles: [] },
        session: { authToken: 'new-token' },
      });
      const win = usePopupWindow();

      // A flow was started; the verifier is now pending.
      await authClient.signInWithOAuth({
        provider: 'google',
        redirectUri: 'https://app.example.com/auth',
      });
      const challenge = new URL(mockOpenUrl.mock.calls[0][0] as string).searchParams.get(
        'codeChallenge'
      );

      // The page reloaded: nothing is listening until this is called.
      expect(authClient.resumeOAuthPopup({ popup })).toBe(true);

      win.deliver({
        source: popup,
        origin: 'https://app.example.com',
        data: { type: 'modelence:oauth-code', code: 'code-from-popup' },
      });
      await vi.waitFor(() => expect(mockCallMethod).toHaveBeenCalled());

      expect(mockCallMethod).toHaveBeenCalledWith('_system.user.loginWithOAuth', {
        code: 'code-from-popup',
        codeVerifier: challenge,
      });
    });

    // Nothing pending means there is no flow to resume, and in particular no
    // listener should be left armed for a code that can never be redeemed.
    test('reports false when no sign-in is pending', () => {
      useNativeClient();
      usePopupWindow();

      expect(authClient.resumeOAuthPopup({ popup: { postMessage: vi.fn() } })).toBe(false);
    });

    test('reports false when given something that is not a window', () => {
      useNativeClient();
      usePopupWindow();

      expect(authClient.resumeOAuthPopup({ popup: Promise.resolve() })).toBe(false);
      expect(authClient.resumeOAuthPopup({ popup: null })).toBe(false);
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
