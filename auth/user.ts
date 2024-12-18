import { randomBytes } from 'crypto';

import { Module } from '../app/module';
import { Store } from '../data/store';
import { schema } from '../data/types';
import { handleSignupWithPassword } from './signup';
import { handleLoginWithPassword, handleLogout } from './login';

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

async function createGuestUser() {
  // TODO: add rate-limiting and captcha handling

  const guestId = randomBytes(9)
    .toString('base64')
    .replace(/[+/]/g, c => c === '+' ? 'a' : 'b');

  const handle = `guest_${guestId}`;
  // TODO: re-try on handle collision

  const result = await usersCollection.insertOne({
    handle,
    createdAt: new Date(),
    authMethods: {},
  });

  return result.insertedId;
}

export default new Module('_system.user', {
  stores: [usersCollection],
  mutations: {
    signupWithPassword: handleSignupWithPassword,
    loginWithPassword: handleLoginWithPassword,
    logout: handleLogout,
  }
});

