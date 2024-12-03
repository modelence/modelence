import { randomBytes } from 'crypto';

import { MongoCollection } from '../db/MongoCollection';
import { getClient } from '../db/client';

export let usersCollection: MongoCollection;

export async function initUsersCollection() {
  const client = getClient();
  if (!client) {
    throw new Error('Failed to init auth: MongoDB client not initialized');
  }

  const rawCollection = client.db().collection('_modelenceUsers');
  await rawCollection.createIndex(
    { handle: 1 },
    {
      unique: true,
      collation: { locale: 'en', strength: 2 }  // Case-insensitive
    }
  );
  usersCollection = new MongoCollection(rawCollection);
}

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
