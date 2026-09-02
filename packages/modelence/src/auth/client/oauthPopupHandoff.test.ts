import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import {
  cancelPopupHandoff,
  isMessageTarget,
  offerVerifierToPopup,
  requestVerifierFromOpener,
} from './oauthPopupHandoff';

/**
 * A stand-in for a browsing context: it records what was posted to it and
 * lets a test deliver a `message` event to its listeners with any `source`
 * and `origin` — which is exactly what an attacker-controlled frame controls.
 */
function makeWindow(origin: string, opener?: unknown) {
  const listeners = new Set<(event: MessageEvent) => void>();
  const posted: Array<{ message: unknown; targetOrigin: string }> = [];

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
    // Test helpers.
    posted,
    listenerCount: () => listeners.size,
    deliver: (event: { source: unknown; origin: string; data: unknown }) => {
      for (const listener of [...listeners]) listener(event as unknown as MessageEvent);
    },
  };
  return win;
}

type FakeWindow = ReturnType<typeof makeWindow>;

const ORIGIN = 'https://app.example.com';

/** Message the popup sends; the shape a probing frame would also know. */
function request(nonce: string) {
  return { type: 'modelence:oauth-verifier-request', nonce };
}

function reply(nonce: string, verifier: string | null) {
  return { type: 'modelence:oauth-verifier-reply', nonce, verifier };
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

  describe('opener side — offerVerifierToPopup', () => {
    let opener: FakeWindow;
    let popup: FakeWindow;
    let takeVerifier: ReturnType<typeof vi.fn<() => string | null>>;

    beforeEach(() => {
      opener = makeWindow(ORIGIN);
      popup = makeWindow(ORIGIN, opener);
      vi.stubGlobal('window', opener);
      takeVerifier = vi.fn<() => string | null>(() => 'the-verifier');
    });

    test('answers a request from the popup it opened, on its own origin', () => {
      offerVerifierToPopup(popup, takeVerifier);

      opener.deliver({ source: popup, origin: ORIGIN, data: request('n1') });

      expect(popup.posted).toEqual([
        { message: reply('n1', 'the-verifier'), targetOrigin: ORIGIN },
      ]);
    });

    // Correlation: the popup only trusts a reply carrying the nonce it sent.
    test('echoes the request nonce in the reply', () => {
      offerVerifierToPopup(popup, takeVerifier);

      opener.deliver({ source: popup, origin: ORIGIN, data: request('specific-nonce') });

      expect((popup.posted[0].message as { nonce: string }).nonce).toBe('specific-nonce');
    });

    test('posts with an explicit target origin, never "*"', () => {
      offerVerifierToPopup(popup, takeVerifier);

      opener.deliver({ source: popup, origin: ORIGIN, data: request('n1') });

      expect(popup.posted[0].targetOrigin).toBe(ORIGIN);
    });

    // Another frame or tab on the same origin that knows the message shape
    // must not be able to obtain the verifier: identity is the window
    // reference `window.open` returned, not the message contents.
    test('ignores a well-formed request from any other window', () => {
      const probe = makeWindow(ORIGIN);
      offerVerifierToPopup(popup, takeVerifier);

      opener.deliver({ source: probe, origin: ORIGIN, data: request('n1') });

      expect(takeVerifier).not.toHaveBeenCalled();
      expect(probe.posted).toEqual([]);
      expect(popup.posted).toEqual([]);
    });

    // The popup navigates through the provider; while it is on a foreign
    // origin, nothing it sends may be answered.
    test('ignores a request from the popup while it is on another origin', () => {
      offerVerifierToPopup(popup, takeVerifier);

      opener.deliver({ source: popup, origin: 'https://evil.example', data: request('n1') });

      expect(takeVerifier).not.toHaveBeenCalled();
      expect(popup.posted).toEqual([]);
    });

    test('ignores unrelated messages from the popup', () => {
      offerVerifierToPopup(popup, takeVerifier);

      opener.deliver({ source: popup, origin: ORIGIN, data: { type: 'something-else' } });
      opener.deliver({ source: popup, origin: ORIGIN, data: 'a string' });
      opener.deliver({ source: popup, origin: ORIGIN, data: null });

      expect(takeVerifier).not.toHaveBeenCalled();
      expect(popup.posted).toEqual([]);
    });

    // Single use: the verifier is handed out once, then the door is closed.
    test('answers at most once', () => {
      offerVerifierToPopup(popup, takeVerifier);

      opener.deliver({ source: popup, origin: ORIGIN, data: request('n1') });
      opener.deliver({ source: popup, origin: ORIGIN, data: request('n2') });

      expect(takeVerifier).toHaveBeenCalledTimes(1);
      expect(popup.posted).toHaveLength(1);
      expect(opener.listenerCount()).toBe(0);
    });

    // Only the most recent flow is redeemable, mirroring startOAuthVerifier.
    test('a new offer replaces the previous one', () => {
      const firstPopup = makeWindow(ORIGIN, opener);
      offerVerifierToPopup(firstPopup, takeVerifier);
      offerVerifierToPopup(popup, takeVerifier);

      opener.deliver({ source: firstPopup, origin: ORIGIN, data: request('n1') });

      expect(firstPopup.posted).toEqual([]);
      expect(opener.listenerCount()).toBe(1);
    });

    // Already consumed — say so, so the popup falls back at once instead of
    // waiting out its timeout.
    test('replies with null when there is no verifier left', () => {
      takeVerifier.mockReturnValue(null);
      offerVerifierToPopup(popup, takeVerifier);

      opener.deliver({ source: popup, origin: ORIGIN, data: request('n1') });

      expect(popup.posted).toEqual([{ message: reply('n1', null), targetOrigin: ORIGIN }]);
    });

    test('cancelPopupHandoff removes the listener', () => {
      offerVerifierToPopup(popup, takeVerifier);

      cancelPopupHandoff();
      opener.deliver({ source: popup, origin: ORIGIN, data: request('n1') });

      expect(opener.listenerCount()).toBe(0);
      expect(popup.posted).toEqual([]);
    });

    test('is a no-op outside a browser', () => {
      vi.stubGlobal('window', undefined);

      expect(() => offerVerifierToPopup(popup, takeVerifier)).not.toThrow();
    });
  });

  describe('popup side — requestVerifierFromOpener', () => {
    let opener: FakeWindow;
    let popup: FakeWindow;

    beforeEach(() => {
      opener = makeWindow(ORIGIN);
      popup = makeWindow(ORIGIN, opener);
      vi.stubGlobal('window', popup);
    });

    function sentNonce(): string {
      return (opener.posted[0].message as { nonce: string }).nonce;
    }

    test('asks the opener on its own origin and resolves with the reply', async () => {
      const pending = requestVerifierFromOpener();

      expect(opener.posted).toHaveLength(1);
      expect(opener.posted[0].targetOrigin).toBe(ORIGIN);
      expect(opener.posted[0].message).toEqual(request(sentNonce()));

      popup.deliver({ source: opener, origin: ORIGIN, data: reply(sentNonce(), 'the-verifier') });

      await expect(pending).resolves.toBe('the-verifier');
    });

    // The request carries a fresh nonce and nothing else — never a verifier.
    test('sends a fresh random nonce each time', async () => {
      const first = requestVerifierFromOpener();
      const firstNonce = sentNonce();
      popup.deliver({ source: opener, origin: ORIGIN, data: reply(firstNonce, null) });
      await first;

      const second = requestVerifierFromOpener();
      const secondNonce = (opener.posted[1].message as { nonce: string }).nonce;
      popup.deliver({ source: opener, origin: ORIGIN, data: reply(secondNonce, null) });
      await second;

      expect(firstNonce).toMatch(/^[0-9a-f]{32}$/);
      expect(secondNonce).not.toBe(firstNonce);
    });

    test('resolves null right away when there is no opener', async () => {
      vi.stubGlobal('window', makeWindow(ORIGIN, null));

      await expect(requestVerifierFromOpener()).resolves.toBeNull();
    });

    test('resolves null outside a browser', async () => {
      vi.stubGlobal('window', undefined);

      await expect(requestVerifierFromOpener()).resolves.toBeNull();
    });

    // A reply from anything but the opener is a spoof attempt; a nonce
    // mismatch is a stale or foreign reply. Both are ignored, not trusted.
    test('ignores replies from other windows, other origins, or other nonces', async () => {
      const pending = requestVerifierFromOpener();
      const nonce = sentNonce();
      const other = makeWindow(ORIGIN);

      popup.deliver({ source: other, origin: ORIGIN, data: reply(nonce, 'spoofed') });
      popup.deliver({
        source: opener,
        origin: 'https://evil.example',
        data: reply(nonce, 'spoofed'),
      });
      popup.deliver({ source: opener, origin: ORIGIN, data: reply('wrong-nonce', 'spoofed') });
      popup.deliver({ source: opener, origin: ORIGIN, data: { type: 'unrelated' } });

      vi.advanceTimersByTime(3000);

      await expect(pending).resolves.toBeNull();
    });

    // A non-Modelence opener (the user arrived here from some other page)
    // never answers; the caller must get its turn to try storage instead.
    test('times out to null when the opener never answers', async () => {
      const pending = requestVerifierFromOpener();

      vi.advanceTimersByTime(2999);
      // Not yet.
      let settled = false;
      void pending.then(() => (settled = true));
      await Promise.resolve();
      expect(settled).toBe(false);

      vi.advanceTimersByTime(1);

      await expect(pending).resolves.toBeNull();
      expect(popup.listenerCount()).toBe(0);
    });

    test('passes through a null reply from an opener with nothing to give', async () => {
      const pending = requestVerifierFromOpener();

      popup.deliver({ source: opener, origin: ORIGIN, data: reply(sentNonce(), null) });

      await expect(pending).resolves.toBeNull();
    });

    test('removes its listener once answered', async () => {
      const pending = requestVerifierFromOpener();

      popup.deliver({ source: opener, origin: ORIGIN, data: reply(sentNonce(), 'v') });
      await pending;

      expect(popup.listenerCount()).toBe(0);
    });

    test('resolves null when posting to the opener throws', async () => {
      const brokenOpener = {
        postMessage: () => {
          throw new Error('detached');
        },
      };
      vi.stubGlobal('window', makeWindow(ORIGIN, brokenOpener));

      await expect(requestVerifierFromOpener()).resolves.toBeNull();
    });
  });

  /**
   * Both halves wired together: the iframe offers, the popup asks, the
   * messages are routed through the fake windows exactly as a browser would
   * route them between two same-origin contexts.
   */
  describe('end to end', () => {
    test('hands the verifier from the opening page to its popup exactly once', async () => {
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

      let stock: string | null = 'minted-in-iframe';
      const takeVerifier = () => {
        const v = stock;
        stock = null;
        return v;
      };

      vi.stubGlobal('window', iframe);
      offerVerifierToPopup(popup, takeVerifier);

      vi.stubGlobal('window', popup);
      await expect(requestVerifierFromOpener()).resolves.toBe('minted-in-iframe');

      // Spent on both sides: the iframe has nothing left and no longer listens.
      expect(stock).toBeNull();
      expect(iframe.listenerCount()).toBe(0);
      const again = requestVerifierFromOpener();
      vi.advanceTimersByTime(3000);
      await expect(again).resolves.toBeNull();
    });
  });
});
