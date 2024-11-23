import { randomBytes } from 'crypto';
import { MongoCollection } from '../db/MongoCollection';
import { getClient } from '../db/client';
import { time } from '../time';
import { MongoClient } from 'mongodb';

let sessionsCollection: MongoCollection;
let usersCollection: MongoCollection;

export async function initAuth() {
  const client = getClient();
  if (!client) {
    throw new Error('Failed to init auth: MongoDB client not initialized');
  }

  sessionsCollection = await initSessionsCollection(client);
  usersCollection = await initUsersCollection(client);
}

async function initSessionsCollection(client: MongoClient) {
  const rawCollection = client.db().collection('_modelenceSessions');
  await rawCollection.createIndexes([
    { key: { authToken: 1 }, unique: true },
    { key: { expiresAt: 1 }},
  ]);
  // TODO: add TTL index on expiresAt
  return new MongoCollection(rawCollection);
}

async function initUsersCollection(client: MongoClient) {
  const rawCollection = client.db().collection('_modelenceUsers');
  await rawCollection.createIndex(
    { handle: 1 },
    {
      unique: true,
      collation: { locale: 'en', strength: 2 }  // Case-insensitive
    }
  );
  return new MongoCollection(rawCollection);
}

export async function fetchSessionByToken(authToken: string | null) {
  const existingSession = authToken ? await sessionsCollection.findOne({ authToken }) : null;
  const session = existingSession ? {
    authToken: existingSession.authToken,
    expiresAt: existingSession.expiresAt,
    userId: existingSession.userId,
  } : await createSession();

  const userDoc = session.userId ? await usersCollection.findOne({ _id: session.userId }) : null;

  const newExpiresAt = new Date(Date.now() + time.days(7));

  if (existingSession) {
    // Extend session expiration
    await sessionsCollection.updateOne(
      { authToken },
      {
        $set: { expiresAt: newExpiresAt }
      }
    );
  }

  return {
    user: userDoc ? {
      id: userDoc._id,
      handle: userDoc.handle,
    } : null,
    session: {
      authToken: session.authToken,
      expiresAt: newExpiresAt,
    }
  };
}

async function createSession() {
  // TODO: add rate-limiting and captcha handling

  const authToken = randomBytes(32).toString('base64url');
  const now = Date.now();
  const expiresAt = new Date(now + time.days(7));

  await sessionsCollection.insertOne({
    authToken,
    createdAt: new Date(now),
    expiresAt,
    userId: null,
  });

  return {
    authToken,
    expiresAt,
    userId: null,
  };
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
