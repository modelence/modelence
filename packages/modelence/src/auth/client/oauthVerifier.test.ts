import { beforeEach, describe, expect, test, vi } from 'vitest';

import { consumeOAuthVerifier, resetOAuthVerifier, startOAuthVerifier } from './oauthVerifier';

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
});
