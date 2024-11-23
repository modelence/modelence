import { randomBytes } from 'crypto';
import { MongoCollection } from '../db/MongoCollection';
import { getClient } from '../db/client';
import { Session, User } from './types';
import { initSessions, obtainSession } from './session';

let usersCollection: MongoCollection;

export async function initAuth() {
  await initSessions();
  await initUsersCollection();
}

async function initUsersCollection() {
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

export async function authenticate(authToken: string | null): Promise<{ session: Session, user: User | null }> {
  const session = await obtainSession(authToken);

  const userDoc = session.userId ? await usersCollection.findOne({ _id: session.userId }) : null;
  const user = userDoc ? {
    id: userDoc._id,
    handle: userDoc.handle,
  } : null;

  return {
    user,
    session,
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
