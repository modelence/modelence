import { describe, expect, test } from 'vitest';
import { createHash } from 'crypto';
import { hashToken } from './tokenHash';

describe('auth/tokenHash', () => {
  test('produces a SHA-256 hex digest of the input', () => {
    const raw = 'abc123';
    const expected = createHash('sha256').update(raw).digest('hex');
    expect(hashToken(raw)).toBe(expected);
  });

  test('is deterministic for the same input', () => {
    expect(hashToken('same-token')).toBe(hashToken('same-token'));
  });

  test('differs for different inputs', () => {
    expect(hashToken('token-a')).not.toBe(hashToken('token-b'));
  });

  test('does not return the raw token', () => {
    const raw = 'super-secret-reset-token';
    expect(hashToken(raw)).not.toContain(raw);
  });

  test('output is a 64-char hex string', () => {
    expect(hashToken('whatever')).toMatch(/^[0-9a-f]{64}$/);
  });
});
