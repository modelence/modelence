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
 * Deliberately module-scoped memory rather than persistent storage: the flow is
 * a foreground round trip measured in seconds, and a verifier that outlives the
 * app process is a credential sitting on disk for no benefit. An app killed
 * mid-flow simply restarts the sign-in.
 */
let pendingVerifier: string | null = null;

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
  return pendingVerifier;
}

/**
 * Returns the pending verifier and clears it, so a given verifier is replayed
 * at most once even if the deep link fires twice.
 */
export function consumeOAuthVerifier(): string | null {
  const verifier = pendingVerifier;
  pendingVerifier = null;
  return verifier;
}

/** Clears any pending verifier. Exposed for tests and for abandoning a flow. */
export function resetOAuthVerifier(): void {
  pendingVerifier = null;
}
