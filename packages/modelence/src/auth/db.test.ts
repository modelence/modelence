import { describe, expect, test } from '@jest/globals';
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
});
