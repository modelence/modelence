import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import {
  awaitCodeFromPopup,
  cancelPopupHandoff,
  hasSeveredOpener,
  isMessageTarget,
  offerCodeToOpener,
} from './oauthPopupHandoff';

/**
 * A stand-in for a browsing context: it records what was posted to it and
 * lets a test deliver a `message` event to its listeners with any `source`
 * and `origin` — which is exactly what an attacker-controlled frame controls.
 */
function makeWindow(origin: string, opener?: unknown) {
  const listeners = new Set<(event: MessageEvent) => void>();
  const posted: Array<{ message: unknown; targetOrigin: string }> = [];
  let closed = false;

  const win = {
    location: { origin },
    opener,
    addEventListener: (_type: 'message', listener: (event: MessageEvent) => void) => {
      listeners.add(listener);
    },
    removeEventListener: (_type: 'message', listener: (event: MessageEvent) => void) => {
      listeners.delete(listener);
    },
    postMessage: (message: unknown, targetOrigin: string) => {
      posted.push({ message, targetOrigin });
    },
    close: () => {
      closed = true;
    },
    // Test helpers.
    posted,
    isClosed: () => closed,
    listenerCount: () => listeners.size,
    deliver: (event: { source: unknown; origin: string; data: unknown }) => {
      for (const listener of [...listeners]) listener(event as unknown as MessageEvent);
    },
  };
  return win;
}

type FakeWindow = ReturnType<typeof makeWindow>;

const ORIGIN = 'https://app.example.com';

/** Message the popup sends; the shape a hostile frame would also know. */
function codeMessage(code: string) {
  return { type: 'modelence:oauth-code', code };
}

function ack(accepted: boolean) {
  return { type: 'modelence:oauth-code-ack', accepted };
}

/**
 * Drains the microtask queue under fake timers.
 *
 * The redemption chain is several `then`/`catch`/`finally` links deep and the
 * rejection path is one link longer than the success path, so tests await the
 * queue draining rather than a hand-counted number of ticks.
 */
async function flush() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

describe('auth/client/oauthPopupHandoff', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cancelPopupHandoff();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  describe('isMessageTarget', () => {
    test('recognises the return value of window.open', () => {
      expect(isMessageTarget({ postMessage: () => {} })).toBe(true);
    });

    // Linking.openURL returns a Promise; a plain openUrl returns nothing.
    // Neither is a window, so native clients never enter the popup path.
    test('rejects a Promise, undefined and null', () => {
      expect(isMessageTarget(Promise.resolve())).toBe(false);
      expect(isMessageTarget(undefined)).toBe(false);
      expect(isMessageTarget(null)).toBe(false);
    });
  });

  describe('opener side — awaitCodeFromPopup', () => {
    let opener: FakeWindow;
    let popup: FakeWindow;
    let completeLogin: ReturnType<typeof vi.fn<(code: string) => Promise<unknown>>>;

    beforeEach(() => {
      opener = makeWindow(ORIGIN);
      popup = makeWindow(ORIGIN, opener);
      vi.stubGlobal('window', opener);
      completeLogin = vi.fn<(code: string) => Promise<unknown>>(() => Promise.resolve('user'));
    });

    test('redeems a code from the popup it opened, on its own origin only', async () => {
      awaitCodeFromPopup(popup, completeLogin);

      opener.deliver({ source: popup, origin: ORIGIN, data: codeMessage('the-code') });
      await flush();

      expect(completeLogin).toHaveBeenCalledWith('the-code');
      expect(popup.posted).toEqual([{ message: ack(true), targetOrigin: ORIGIN }]);
    });

    // The session must be established in the opener, so the popup has no
    // further purpose once it has handed the code over.
    test('closes the popup once the code has been redeemed', async () => {
      awaitCodeFromPopup(popup, completeLogin);

      opener.deliver({ source: popup, origin: ORIGIN, data: codeMessage('the-code') });
      await flush();

      expect(popup.isClosed()).toBe(true);
    });

    // Another frame or tab on the same origin that knows the message shape
    // must not be able to feed us a code: identity is the window reference
    // `window.open` returned, not the message contents.
    test('ignores a well-formed code from any other window', async () => {
      const hostile = makeWindow(ORIGIN);
      awaitCodeFromPopup(popup, completeLogin);

      opener.deliver({ source: hostile, origin: ORIGIN, data: codeMessage('injected') });
      await flush();

      expect(completeLogin).not.toHaveBeenCalled();
      expect(hostile.posted).toEqual([]);
    });

    // The popup navigates through the provider; while it is on a foreign
    // origin, nothing it sends may be acted on.
    test('ignores a code from the popup while it is on another origin', async () => {
      awaitCodeFromPopup(popup, completeLogin);

      opener.deliver({ source: popup, origin: 'https://evil.example', data: codeMessage('c') });
      await flush();

      expect(completeLogin).not.toHaveBeenCalled();
    });

    test('ignores unrelated or malformed messages from the popup', async () => {
      awaitCodeFromPopup(popup, completeLogin);

      opener.deliver({ source: popup, origin: ORIGIN, data: { type: 'something-else' } });
      opener.deliver({ source: popup, origin: ORIGIN, data: codeMessage('') });
      opener.deliver({ source: popup, origin: ORIGIN, data: { type: 'modelence:oauth-code' } });
      opener.deliver({ source: popup, origin: ORIGIN, data: 'a string' });
      opener.deliver({ source: popup, origin: ORIGIN, data: null });
      await flush();

      expect(completeLogin).not.toHaveBeenCalled();
    });

    // Single use: a popup that posts twice must not start two redemptions of
    // a code the server will only honour once.
    test('redeems at most once', async () => {
      awaitCodeFromPopup(popup, completeLogin);

      opener.deliver({ source: popup, origin: ORIGIN, data: codeMessage('the-code') });
      opener.deliver({ source: popup, origin: ORIGIN, data: codeMessage('the-code') });
      await flush();

      expect(completeLogin).toHaveBeenCalledTimes(1);
      expect(opener.listenerCount()).toBe(0);
    });

    // Only the most recent flow is live, mirroring startOAuthVerifier.
    test('a new flow replaces the previous one', async () => {
      const firstPopup = makeWindow(ORIGIN, opener);
      awaitCodeFromPopup(firstPopup, completeLogin);
      awaitCodeFromPopup(popup, completeLogin);

      opener.deliver({ source: firstPopup, origin: ORIGIN, data: codeMessage('stale') });
      await flush();

      expect(completeLogin).not.toHaveBeenCalled();
      expect(opener.listenerCount()).toBe(1);
    });

    // The listener is not a place an exception can propagate from, so a failed
    // redemption has to be reported rather than thrown.
    test('reports a failed redemption to onError instead of throwing', async () => {
      const failure = new Error('code expired');
      completeLogin.mockRejectedValue(failure);
      const onError = vi.fn();

      awaitCodeFromPopup(popup, completeLogin, onError);
      expect(() =>
        opener.deliver({ source: popup, origin: ORIGIN, data: codeMessage('the-code') })
      ).not.toThrow();
      await flush();

      expect(onError).toHaveBeenCalledWith(failure);
      // Still closed: the code is spent either way.
      expect(popup.isClosed()).toBe(true);
    });

    // A popup that has already navigated away or been closed by the user
    // cannot be acknowledged, which must not prevent redemption.
    test('redeems even when acknowledging the popup throws', async () => {
      const brokenPopup = {
        postMessage: () => {
          throw new Error('detached');
        },
      };
      awaitCodeFromPopup(brokenPopup, completeLogin);

      opener.deliver({ source: brokenPopup, origin: ORIGIN, data: codeMessage('the-code') });
      await flush();

      expect(completeLogin).toHaveBeenCalledWith('the-code');
    });

    test('cancelPopupHandoff removes the listener', async () => {
      awaitCodeFromPopup(popup, completeLogin);

      cancelPopupHandoff();
      opener.deliver({ source: popup, origin: ORIGIN, data: codeMessage('the-code') });
      await flush();

      expect(opener.listenerCount()).toBe(0);
      expect(completeLogin).not.toHaveBeenCalled();
    });

    test('is a no-op outside a browser', () => {
      vi.stubGlobal('window', undefined);

      expect(() => awaitCodeFromPopup(popup, completeLogin)).not.toThrow();
    });
  });

  describe('popup side — offerCodeToOpener', () => {
    let opener: FakeWindow;
    let popup: FakeWindow;

    beforeEach(() => {
      opener = makeWindow(ORIGIN);
      popup = makeWindow(ORIGIN, opener);
      vi.stubGlobal('window', popup);
    });

    test('offers the code to the opener on its own origin and reports acceptance', async () => {
      const pending = offerCodeToOpener('the-code');

      expect(opener.posted).toEqual([{ message: codeMessage('the-code'), targetOrigin: ORIGIN }]);

      popup.deliver({ source: opener, origin: ORIGIN, data: ack(true) });

      await expect(pending).resolves.toBe(true);
      expect(popup.listenerCount()).toBe(0);
    });

    // No opener at all is the ordinary same-tab flow: this page redeems.
    test('resolves false right away when there is no opener', async () => {
      vi.stubGlobal('window', makeWindow(ORIGIN, null));

      await expect(offerCodeToOpener('the-code')).resolves.toBe(false);
    });

    test('resolves false outside a browser', async () => {
      vi.stubGlobal('window', undefined);

      await expect(offerCodeToOpener('the-code')).resolves.toBe(false);
    });

    // An acknowledgement from anything but the opener is a spoof attempt: were
    // it trusted, a hostile frame could make this page drop a valid code.
    test('ignores acknowledgements from other windows or other origins', async () => {
      const pending = offerCodeToOpener('the-code');
      const other = makeWindow(ORIGIN);

      popup.deliver({ source: other, origin: ORIGIN, data: ack(true) });
      popup.deliver({ source: opener, origin: 'https://evil.example', data: ack(true) });
      popup.deliver({ source: opener, origin: ORIGIN, data: { type: 'unrelated' } });

      vi.advanceTimersByTime(3000);

      await expect(pending).resolves.toBe(false);
    });

    // A non-Modelence opener (the user arrived here from some other page)
    // never answers; the caller must not hang, and must still be able to
    // finish the sign-in itself.
    test('times out to false when the opener never answers', async () => {
      const pending = offerCodeToOpener('the-code');

      vi.advanceTimersByTime(2999);
      let settled = false;
      void pending.then(() => (settled = true));
      await Promise.resolve();
      expect(settled).toBe(false);

      vi.advanceTimersByTime(1);

      await expect(pending).resolves.toBe(false);
      expect(popup.listenerCount()).toBe(0);
    });

    test('passes through an explicit refusal', async () => {
      const pending = offerCodeToOpener('the-code');

      popup.deliver({ source: opener, origin: ORIGIN, data: ack(false) });

      await expect(pending).resolves.toBe(false);
    });

    test('resolves false when posting to the opener throws', async () => {
      const brokenOpener = {
        postMessage: () => {
          throw new Error('detached');
        },
      };
      vi.stubGlobal('window', makeWindow(ORIGIN, brokenOpener));

      await expect(offerCodeToOpener('the-code')).resolves.toBe(false);
    });
  });

  describe('hasSeveredOpener', () => {
    // The COOP case: this page was opened as a popup, but the provider's
    // sign-in page cut the link, so there is nobody to hand the code to.
    test('is true when window.opener is explicitly null', () => {
      vi.stubGlobal('window', makeWindow(ORIGIN, null));

      expect(hasSeveredOpener()).toBe(true);
    });

    test('is false when an opener is present', () => {
      const opener = makeWindow(ORIGIN);
      vi.stubGlobal('window', makeWindow(ORIGIN, opener));

      expect(hasSeveredOpener()).toBe(false);
    });

    // An ordinary top-level page has no `opener` property at all, which is not
    // the same as having had one severed.
    test('is false for a page that was never a popup', () => {
      vi.stubGlobal('window', makeWindow(ORIGIN));

      expect(hasSeveredOpener()).toBe(false);
    });

    test('is false outside a browser', () => {
      vi.stubGlobal('window', undefined);

      expect(hasSeveredOpener()).toBe(false);
    });
  });

  /**
   * Both halves wired together: the popup offers, the iframe redeems. The
   * messages are routed through the fake windows exactly as a browser would
   * route them between two same-origin contexts.
   */
  describe('end to end', () => {
    test('the code travels to the opener, which signs in and closes the popup', async () => {
      const iframe = makeWindow(ORIGIN);
      const popup = makeWindow(ORIGIN, iframe);
      // Route: whatever one side posts is delivered to the other as a message
      // event whose source is the poster.
      iframe.postMessage = (message, targetOrigin) => {
        if (targetOrigin === ORIGIN)
          iframe.deliver({ source: popup, origin: ORIGIN, data: message });
      };
      popup.postMessage = (message, targetOrigin) => {
        if (targetOrigin === ORIGIN)
          popup.deliver({ source: iframe, origin: ORIGIN, data: message });
      };

      // The verifier stays here and is never posted anywhere.
      const verifier = 'minted-in-iframe';
      const redeemed: Array<{ code: string; verifier: string }> = [];

      vi.stubGlobal('window', iframe);
      awaitCodeFromPopup(popup, async (code) => {
        redeemed.push({ code, verifier });
        return 'user';
      });

      vi.stubGlobal('window', popup);
      const accepted = offerCodeToOpener('the-code');
      await flush();
      await expect(accepted).resolves.toBe(true);

      // Redeemed once, in the iframe, pairing the code with the local verifier.
      expect(redeemed).toEqual([{ code: 'the-code', verifier: 'minted-in-iframe' }]);
      expect(popup.isClosed()).toBe(true);

      // Spent: the iframe no longer listens, so a replayed code goes nowhere.
      expect(iframe.listenerCount()).toBe(0);
      const again = offerCodeToOpener('the-code');
      vi.advanceTimersByTime(3000);
      await expect(again).resolves.toBe(false);
      expect(redeemed).toHaveLength(1);
    });

    // No token ever crosses the channel — only the code, which is useless
    // without the verifier the opener keeps to itself.
    test('nothing but the code and its acknowledgement is posted', async () => {
      const iframe = makeWindow(ORIGIN);
      const popup = makeWindow(ORIGIN, iframe);

      vi.stubGlobal('window', iframe);
      awaitCodeFromPopup(popup, async () => ({ session: { authToken: 'secret-token' } }));

      iframe.deliver({ source: popup, origin: ORIGIN, data: codeMessage('the-code') });
      await flush();

      expect(popup.posted).toEqual([{ message: ack(true), targetOrigin: ORIGIN }]);
      expect(JSON.stringify(popup.posted)).not.toContain('secret-token');
    });
  });
});
