/**
 * Device-side binding for the native OAuth flow (PKCE-style).
 *
 * The deep link that carries the exchange code back into the app is the weakest
 * hop in the chain: a custom scheme can be claimed by any installed app, and a
 * crafted `myapp://auth?code=...` can be handed to the device from outside the
 * flow entirely. Without a device-held secret, redeeming such a code silently
 * rebinds the session to whoever minted it.
 *
 * So `signInWithOAuth` mints a verifier, keeps it in memory, and sends only a
 * derived challenge to the server. `loginWithOAuth` replays the verifier at
 * redemption, and the server checks it against the challenge bound to the code
 * when it was minted. A code minted for an attacker's flow carries the
 * attacker's challenge and cannot be redeemed by this device.
 *
 * Why not the RFC 7636 `S256` transform: bare React Native ships neither
 * `crypto.subtle` nor `crypto.getRandomValues`, so a SHA-256 challenge would
 * force a native crypto dependency on every consumer. The challenge is instead
 * sent as the verifier itself over TLS and stored only as a hash server-side,
 * which is the `plain` method of the same RFC. The property that matters here —
 * a code is redeemable only by the device that started the flow — is identical;
 * what `S256` additionally protects against is a challenge leaking from the
 * *authorization request*, which for us never leaves the TLS channel between
 * the app and its own server.
 */

import { randomHex } from './randomHex';

/** Verifier length in characters. 32 bytes of entropy, hex-encoded. */
const VERIFIER_BYTES = 32;

/**
 * The verifier for the in-flight sign-in.
 *
 * Memory suffices on native, where the app survives in the background. A
 * browser — including Expo Web, where `Linking.openURL` navigates the same tab —
 * tears down this module on the way to the provider, so it is mirrored into
 * `sessionStorage`: tab-scoped and discarded on close, which fits a credential
 * that lives for one redirect round trip.
 */
let pendingVerifier: string | null = null;
const STORAGE_KEY = 'modelence.oauth.verifier';

/**
 * Returns `sessionStorage` when it is usable, else null. Access can throw
 * outright (Safari private mode, webviews with storage disabled), and presence
 * does not imply usability — hence the probe.
 */
function getSessionStorage(): Storage | null {
  try {
    const storage = (globalThis as { sessionStorage?: Storage }).sessionStorage;
    if (!storage) return null;
    const probe = `${STORAGE_KEY}.probe`;
    storage.setItem(probe, '1');
    storage.removeItem(probe);
    return storage;
  } catch {
    return null;
  }
}

/**
 * Mints a fresh verifier for a new sign-in and returns the challenge to send.
 *
 * Any previously pending verifier is discarded: only the most recently started
 * flow is redeemable, so an abandoned flow cannot be completed later.
 */
export function startOAuthVerifier(): string {
  pendingVerifier = randomHex(VERIFIER_BYTES);

  // Mirrored so a browser flow survives the navigation to the provider. Failure
  // to persist is not fatal: native runtimes rely on the in-memory copy.
  try {
    getSessionStorage()?.setItem(STORAGE_KEY, pendingVerifier);
  } catch {
    // Storage full or blocked mid-flow; the in-memory value still applies.
  }

  return pendingVerifier;
}

/**
 * Returns the pending verifier and clears it, so a given verifier is replayed
 * at most once even if the deep link fires twice.
 */
export function consumeOAuthVerifier(): string | null {
  // In-memory first: it is authoritative on native and identical on web when
  // the page was never replaced.
  const verifier = pendingVerifier ?? getSessionStorage()?.getItem(STORAGE_KEY) ?? null;
  resetOAuthVerifier();
  return verifier;
}

/**
 * Drops only the in-memory copy, leaving any persisted one intact.
 *
 * Exists to let tests reproduce a page navigation, which is precisely the case
 * the persisted copy exists for: the module is rebuilt, storage is not.
 */
export function __resetInMemoryVerifierForTests(): void {
  pendingVerifier = null;
}

/** Clears any pending verifier. Exposed for tests and for abandoning a flow. */
export function resetOAuthVerifier(): void {
  pendingVerifier = null;
  try {
    getSessionStorage()?.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to do — a verifier that cannot be cleared still expires with the tab.
  }
}
