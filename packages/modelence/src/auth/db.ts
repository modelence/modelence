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
    emails: schema.array(schema.object({
      address: schema.string(),
      verified: schema.boolean(),
    })).optional(),
    createdAt: schema.date(),
    authMethods: schema.object({
      password: schema.object({
        hash: schema.string(),
      }).optional(),
      google: schema.object({
        id: schema.string(),
      }).optional(),
    }),
  },
  indexes: [
    {
      key: { handle: 1 },
      unique: true,
      collation: { locale: 'en', strength: 2 }  // Case-insensitive
    },
  ]
});

export const dbDisposableEmailDomains = new Store('_modelenceDisposableEmailDomains', {
  schema: {
    domain: schema.string(),
    addedAt: schema.date(),
  },
  indexes: [
    {
      key: { domain: 1 },
      unique: true
    }
  ]
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
      unique: true
    },
    {
      key: { expiresAt: 1 },
      expireAfterSeconds: 0
    }
  ]
});
