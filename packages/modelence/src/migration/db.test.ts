import { describe, expect, test } from 'vitest';
import { dbMigrations } from './db';

describe('migration/db', () => {
  test('dbMigrations should be defined', () => {
    expect(dbMigrations).toBeDefined();
  });
});
