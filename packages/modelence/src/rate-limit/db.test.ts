import { describe, expect, test } from 'vitest';
import { dbRateLimits } from './db';

describe('rate-limit/db', () => {
  test('dbRateLimits should be defined', () => {
    expect(dbRateLimits).toBeDefined();
  });
});
