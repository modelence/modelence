import { schema } from '../data/types';
import { Store } from '../data/store';

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
    name: schema.string().optional(),
    picture: schema.string().optional(),
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
      key: { 'authMethods.google.id': 1, status: 1 },
      sparse: true,
    },
    {
      key: { 'authMethods.github.id': 1, status: 1 },
      sparse: true,
    },
  ],
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
