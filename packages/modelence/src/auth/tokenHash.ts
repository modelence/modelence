import { createHash } from 'crypto';

/**
 * Hashes a bearer token for storage at rest, so a db leak exposes no usable
 * tokens. SHA-256 (not bcrypt): these tokens are already 256-bit random, so
 * there's nothing to brute-force and a fast hash keeps lookups cheap.
 */
export function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}
