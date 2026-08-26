import { beforeEach, describe, expect, test, vi } from 'vitest';

import {
  __resetInMemoryVerifierForTests as resetInMemoryOnly,
  consumeOAuthVerifier,
  resetOAuthVerifier,
  startOAuthVerifier,
} from './oauthVerifier';

describe('auth/client/oauthVerifier', () => {
  beforeEach(() => {
    resetOAuthVerifier();
    vi.unstubAllGlobals();
  });

  test('returns a high-entropy hex challenge', () => {
    expect(startOAuthVerifier()).toMatch(/^[0-9a-f]{64}$/);
  });

  test('mints a different verifier each time', () => {
    expect(startOAuthVerifier()).not.toBe(startOAuthVerifier());
  });

  test('replays the pending verifier once', () => {
    const challenge = startOAuthVerifier();

    expect(consumeOAuthVerifier()).toBe(challenge);
  });

  // A deep link can fire more than once; the second delivery must not be able
  // to redeem anything.
  test('does not replay the same verifier twice', () => {
    startOAuthVerifier();
    consumeOAuthVerifier();

    expect(consumeOAuthVerifier()).toBeNull();
  });

  test('returns null when no flow was started', () => {
    expect(consumeOAuthVerifier()).toBeNull();
  });

  // Only the most recently started flow is redeemable, so an abandoned sign-in
  // cannot be completed later.
  test('starting a new flow discards the previous verifier', () => {
    const first = startOAuthVerifier();
    const second = startOAuthVerifier();

    expect(consumeOAuthVerifier()).toBe(second);
    expect(second).not.toBe(first);
  });

  test('uses crypto.getRandomValues when the runtime provides it', () => {
    const getRandomValues = vi.fn((bytes: Uint8Array) => {
      bytes.fill(0xab);
      return bytes;
    });
    vi.stubGlobal('crypto', { getRandomValues });

    expect(startOAuthVerifier()).toBe('ab'.repeat(32));
    expect(getRandomValues).toHaveBeenCalledTimes(1);
  });

  // Bare React Native ships no crypto global at all; the flow must still work.
  test('falls back to Math.random when there is no crypto global', () => {
    vi.stubGlobal('crypto', undefined);

    expect(startOAuthVerifier()).toMatch(/^[0-9a-f]{64}$/);
  });
  /**
   * The Expo Web case: the same code that runs on native calls
   * signInWithOAuth({ redirectUri }), but Linking.openURL is a same-tab
   * navigation there, so the module is torn down before the code comes back.
   */
  describe('surviving a page navigation', () => {
    function makeSessionStorage() {
      const data = new Map<string, string>();
      return {
        getItem: (k: string) => data.get(k) ?? null,
        setItem: (k: string, v: string) => void data.set(k, v),
        removeItem: (k: string) => void data.delete(k),
        clear: () => data.clear(),
        key: () => null,
        length: 0,
      } as unknown as Storage;
    }

    test('a verifier minted before a navigation is still redeemable after it', () => {
      const storage = makeSessionStorage();
      vi.stubGlobal('sessionStorage', storage);

      const challenge = startOAuthVerifier();

      // The navigation: module state is gone, storage is not.
      resetInMemoryOnly();

      expect(consumeOAuthVerifier()).toBe(challenge);
    });

    test('consuming after a navigation clears the stored copy too', () => {
      vi.stubGlobal('sessionStorage', makeSessionStorage());

      startOAuthVerifier();
      resetInMemoryOnly();
      consumeOAuthVerifier();

      // A second delivery of the same deep link must find nothing.
      expect(consumeOAuthVerifier()).toBeNull();
    });

    test('reset clears the stored copy, not just memory', () => {
      vi.stubGlobal('sessionStorage', makeSessionStorage());

      startOAuthVerifier();
      resetOAuthVerifier();
      resetInMemoryOnly();

      expect(consumeOAuthVerifier()).toBeNull();
    });

    // Safari private mode and some embedded webviews throw on access.
    test('works when sessionStorage access throws', () => {
      vi.stubGlobal('sessionStorage', {
        get getItem(): never {
          throw new Error('blocked');
        },
        setItem: () => {
          throw new Error('blocked');
        },
        removeItem: () => {
          throw new Error('blocked');
        },
      } as unknown as Storage);

      const challenge = startOAuthVerifier();

      // No persistence, but the in-memory path is unaffected — which is every
      // native runtime.
      expect(consumeOAuthVerifier()).toBe(challenge);
    });

    test('works when there is no sessionStorage at all', () => {
      vi.stubGlobal('sessionStorage', undefined);

      const challenge = startOAuthVerifier();

      expect(consumeOAuthVerifier()).toBe(challenge);
    });
  });
});
