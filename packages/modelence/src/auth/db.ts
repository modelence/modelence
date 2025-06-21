import { schema } from '../data/types';
import { Store } from '../data/store';

/**
 * Database collection for storing user accounts with authentication methods and profile information.
 * 
 * This is where **signupWithPassword** automatically creates new users.
 * 
 * @example
 * ```typescript
 * // Create a new user
 * const result = await dbUsers.insertOne({
 *   handle: 'john_doe',
 *   emails: [{ address: 'john@example.com', verified: false }],
 *   createdAt: new Date(),
 *   authMethods: {
 *     password: { hash: 'hashed_password' }
 *   }
 * });
 * 
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
