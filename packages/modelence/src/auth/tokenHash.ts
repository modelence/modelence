import { createHash } from 'crypto';

/**
 * Hashes a token for storage at rest.
 *
 * Reset/verification tokens are bearer secrets: anyone holding the raw value can
 * consume the flow. Storing only a hash means a database leak does not expose
 * usable tokens. We use SHA-256 (not bcrypt) because these tokens are already
 * high-entropy (256-bit random), so a fast hash is sufficient and keeps lookups
 * cheap — there is nothing to brute-force.
 */
export function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}
