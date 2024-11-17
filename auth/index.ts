import { randomBytes } from 'crypto';

import { MongoCollection } from '../db/MongoCollection';
import { getClient } from '../db/client';
import { time } from '../time';

let usersCollection: MongoCollection;

export async function initAuth() {
  const client = getClient();
  if (!client) {
    throw new Error('Failed to init auth: MongoDB client not initialized');
  }

  const rawCollection = client.db().collection('_modelenceUsers');
  rawCollection.createIndex(
    { handle: 1 },
    {
      unique: true,
      collation: { locale: 'en', strength: 2 }  // Case-insensitive
    }
  );
  usersCollection = new MongoCollection(rawCollection);
}

export async function fetchSessionByToken(authToken?: string) {
  if (!authToken) {
    return await createGuestUser();
  }

  const userDoc = await usersCollection.findOne({
    'sessions.authToken': authToken,
  });

  if (!userDoc) {
    return await createGuestUser();
  }

  const session = userDoc.sessions.find(s => s.authToken === authToken);

  const expiresAt = Date.now() + time.days(14);
  await usersCollection.updateOne(
    { 
      _id: userDoc._id,
      'sessions.authToken': authToken 
    },
    { 
      $set: { 'sessions.$.expiresAt': expiresAt }
    }
  );
  
  return {
    user: {
      id: userDoc._id,
      isGuest: userDoc.isGuest,
    },
    session: {
      authToken: session.authToken,
      expiresAt
    }
  };
}

async function createGuestUser() {
  // TODO: add rate-limiting and captcha handling

  const newAuthToken = randomBytes(32).toString('base64url');
  const expiresAt = Date.now() + time.days(14);

  const guestId = randomBytes(9)
    .toString('base64')
    .replace(/[+/]/g, c => c === '+' ? 'a' : 'b');

  // TODO: re-try on handle collision
  
  const result = await usersCollection.insertOne({
    handle: `guest_${guestId}`,
    isGuest: true,
    sessions: [{
      authToken: newAuthToken,
      expiresAt
    }],
    createdAt: new Date(),
  });

  return {
    user: {
      id: result.insertedId,
      isGuest: true,
    },
    session: {
      authToken: newAuthToken,
      expiresAt
    }
  }
}
