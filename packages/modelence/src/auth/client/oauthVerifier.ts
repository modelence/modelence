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

/** Verifier length in characters. 32 bytes of entropy, hex-encoded. */
const VERIFIER_BYTES = 32;

/**
 * The verifier for the in-flight sign-in.
 *
 * Module-scoped memory is enough on native, where the app stays alive in the
 * background while the system browser is in front. It is *not* enough in a
 * browser — including Expo Web, where the same code runs and `Linking.openURL`
 * is a same-tab navigation — because leaving the page tears down this module
 * and the return trip starts a fresh one.
 */
let pendingVerifier: string | null = null;

/**
 * Where a browser keeps the verifier across the navigation to the provider.
 *
 * `sessionStorage` rather than `localStorage`: it is scoped to the one tab
 * running the flow and is discarded when that tab closes, which suits a
 * credential whose useful life is the ~60 seconds of a redirect round trip.
 * Absent on native, where the in-memory value already survives.
 */
const STORAGE_KEY = 'modelence.oauth.verifier';

/**
 * Returns `sessionStorage` when it is usable, else null.
 *
 * Access itself can throw — Safari in private mode historically did, and some
 * embedded webviews disable storage entirely — so this must never be assumed
 * to work. When it is unavailable the flow still works everywhere the in-memory
 * value survives, which is every native runtime.
 */
function getSessionStorage(): Storage | null {
  try {
    const storage = (globalThis as { sessionStorage?: Storage }).sessionStorage;
    if (!storage) return null;
    // Probe: presence is not the same as usability.
    const probe = `${STORAGE_KEY}.probe`;
    storage.setItem(probe, '1');
    storage.removeItem(probe);
    return storage;
  } catch {
    return null;
  }
}

/**
 * Random hex string, using the best source the runtime offers.
 *
 * `crypto.getRandomValues` exists in browsers, Expo (via `expo-crypto`'s global
 * install) and Hermes with a polyfill; bare React Native has none of them, so
 * `Math.random` is the documented fallback. That fallback is weaker than a CSPRNG,
 * but the verifier only needs to be unguessable by an attacker who cannot read
 * the device's memory — and an attacker who can read process memory has already
 * won regardless of the entropy source.
 */
function randomHex(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);

  const cryptoObj = (globalThis as { crypto?: Crypto }).crypto;
  if (cryptoObj?.getRandomValues) {
    cryptoObj.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }

  let out = '';
  for (const byte of bytes) {
    out += byte.toString(16).padStart(2, '0');
  }
  return out;
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
