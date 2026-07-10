import { describe, expect, test } from 'vitest';
import {
  usersCollection,
  dbDisposableEmailDomains,
  emailVerificationTokensCollection,
  resetPasswordTokensCollection,
} from './db';

describe('auth/db', () => {
  test('usersCollection should be defined', () => {
    expect(usersCollection).toBeDefined();
  });

  test('dbDisposableEmailDomains should be defined', () => {
    expect(dbDisposableEmailDomains).toBeDefined();
  });

  test('emailVerificationTokensCollection should be defined', () => {
    expect(emailVerificationTokensCollection).toBeDefined();
  });

  test('resetPasswordTokensCollection should be defined', () => {
    expect(resetPasswordTokensCollection).toBeDefined();
  });

  test('usersCollection enforces a case-insensitive partial-unique index on emails.address', () => {
    const emailUniqueIndex = usersCollection
      .getIndexes()
      .find(
        (index) =>
          index.unique === true &&
          JSON.stringify(index.key) === JSON.stringify({ 'emails.address': 1 })
      );

    // Without this index the check-then-insert in the signup paths races and
    // can create duplicate accounts for one email.
    expect(emailUniqueIndex).toBeDefined();
    expect(emailUniqueIndex?.collation).toMatchObject({ locale: 'en', strength: 2 });
    expect(emailUniqueIndex?.partialFilterExpression).toEqual({
      'emails.address': { $exists: true },
    });
  });
});
