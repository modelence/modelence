import { randomBytes } from 'crypto';

import { Module } from '../app/module';
import { Store } from '../data/store';
import { SchemaTypes } from '../data/types';
import { handleSignupWithPassword } from './signup';

// TODO: get rid of, directly infer from schema
type DataType = {
  handle: string;
  email: string;
  createdAt: Date;
};

export const usersCollection = new Store<DataType>('_modelenceUsers', {
  schema: {
    handle: SchemaTypes.String,
    email: SchemaTypes.String,
    createdAt: SchemaTypes.Date,
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
  });

  return result.insertedId;
}

export default new Module('_system.user', {
  stores: [usersCollection],
  mutations: {
    signupWithPassword: handleSignupWithPassword,
  }
});

