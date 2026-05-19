import { describe, expect, test } from 'vitest';
import { locksCollection } from './db';

describe('lock/db', () => {
  test('locksCollection should be defined', () => {
    expect(locksCollection).toBeDefined();
  });
});
