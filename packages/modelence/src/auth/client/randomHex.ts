/**
 * Random hex string from the best source the runtime offers.
 *
 * Bare React Native has no `crypto.getRandomValues`, so `Math.random` is the
 * fallback. It is weaker than a CSPRNG, but the values minted here only need to
 * resist an attacker who cannot read process memory — and one who can has
 * already won.
 */
export function randomHex(byteLength: number): string {
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
