import { MongoServerError } from 'mongodb';
import { schema } from '../data/types';
import { Store } from '../data/store';
import { findDuplicateEmails, formatDuplicateEmailReport } from './duplicateEmails';

/**
 * Database collection for storing user accounts with authentication methods and profile information.
 *
 * This is where **signupWithPassword** automatically creates new users.
 *
 * @example
 * ```typescript
 * // Find user by email
 * const user = await dbUsers.findOne(
 *   { 'emails.address': 'john@example.com' }
 * );
 * ```
 *
 */
export const usersCollection = new Store('_modelenceUsers', {
  schema: {
    handle: schema.string(),
    emails: schema
      .array(
        schema.object({
          address: schema.string(),
          verified: schema.boolean(),
        })
      )
      .optional(),
    status: schema.enum(['active', 'disabled', 'deleted']).optional(),
    firstName: schema.string().optional(),
    lastName: schema.string().optional(),
    avatarUrl: schema.string().optional(),
    createdAt: schema.date(),
    disabledAt: schema.date().optional(),
    deletedAt: schema.date().optional(),
    roles: schema.array(schema.string()).optional(),
    authMethods: schema.object({
      password: schema
        .object({
          hash: schema.string(),
        })
        .optional(),
      google: schema
        .object({
          id: schema.string(),
        })
        .optional(),
      github: schema
        .object({
          id: schema.string(),
        })
        .optional(),
    }),
  },
  indexes: [
    {
      key: { handle: 1 },
      unique: true,
      collation: { locale: 'en', strength: 2 }, // Case-insensitive
    },
    {
      key: { 'emails.address': 1, status: 1 },
    },
    {
      // Race-proof guard against two accounts sharing an email: the check-then-
      // insert in the signup paths (password + magic link) can interleave, so
      // the DB must enforce uniqueness. Case-insensitive collation matches the
      // `handle` index and the emails.address lookups. Partial so the many
      // legacy/optional docs without an `emails` array don't all collide on null.
      key: { 'emails.address': 1 },
      unique: true,
      collation: { locale: 'en', strength: 2 },
      partialFilterExpression: { 'emails.address': { $exists: true } },
    },
    {
      key: { 'authMethods.google.id': 1 },
      sparse: true,
      unique: true,
    },
    {
      key: { 'authMethods.github.id': 1 },
      sparse: true,
      unique: true,
    },
  ],
  // When the unique emails.address index cannot build because the collection
  // already has duplicate-email accounts (possible on apps that ran before the
  // constraint existed), don't fail silently: report exactly which emails block
  // it so an operator can resolve them. Startup still continues.
  onIndexError: async (error) => {
    const isEmailUniquenessViolation =
      error instanceof MongoServerError &&
      // 11000 = duplicate key surfaced while building a unique index.
      error.code === 11000 &&
      typeof error.message === 'string' &&
      error.message.includes('emails.address');

    if (!isEmailUniquenessViolation) {
      return;
    }

    const duplicates = await findDuplicateEmails();
    if (duplicates.length > 0) {
      console.error(formatDuplicateEmailReport(duplicates));
    }
  },
});

export const dbDisposableEmailDomains = new Store('_modelenceDisposableEmailDomains', {
  schema: {
    domain: schema.string(),
    addedAt: schema.date(),
  },
  indexes: [
    {
      key: { domain: 1 },
      unique: true,
    },
  ],
});

export const emailVerificationTokensCollection = new Store('_modelenceEmailVerificationTokens', {
  schema: {
    userId: schema.objectId(),
    email: schema.string().optional(),
    token: schema.string(),
    createdAt: schema.date(),
    expiresAt: schema.date(),
  },
  indexes: [
    {
      key: { token: 1 },
      unique: true,
    },
    {
      key: { expiresAt: 1 },
      expireAfterSeconds: 0,
    },
  ],
});

export const resetPasswordTokensCollection = new Store('_modelenceResetPasswordTokens', {
  schema: {
    userId: schema.objectId(),
    email: schema.string().optional(),
    token: schema.string(),
    createdAt: schema.date(),
    expiresAt: schema.date(),
  },
  indexes: [
    {
      key: { token: 1 },
      unique: true,
    },
    {
      key: { expiresAt: 1 },
      expireAfterSeconds: 0,
    },
  ],
});

// No userId field: the login mutation re-resolves the user by email to support
// find-or-create (magic link signs up unknown emails), and a userId captured at
// send time could go stale before the link is clicked.
//
// Each doc backs two credentials for the same sign-in: the long `token` (link)
// and the short `code` (typed one-time code). Consuming either deletes the doc,
// invalidating both.
export const magicLinkTokensCollection = new Store('_modelenceMagicLinkTokens', {
  schema: {
    email: schema.string(),
    token: schema.string(),
    code: schema.string(),
    // Failed code guesses; docs at the attempt cap can no longer be used.
    attempts: schema.number(),
    createdAt: schema.date(),
    expiresAt: schema.date(),
  },
  indexes: [
    {
      key: { token: 1 },
      unique: true,
    },
    {
      key: { expiresAt: 1 },
      expireAfterSeconds: 0,
    },
  ],
});
