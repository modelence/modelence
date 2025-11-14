import { describe, expect, test } from '@jest/globals';
import { dbRateLimits } from './db';

describe('rate-limit/db', () => {
  test('dbRateLimits should be defined', () => {
    expect(dbRateLimits).toBeDefined();
  });
});
