import { randomBytes } from 'crypto';
import { time } from '../time';
import { MongoCollection } from '../db/MongoCollection';
import { getClient } from '../db/client';
import { Session } from './types';

let sessionsCollection: MongoCollection;

export async function initSessions() {
  const client = getClient();
  if (!client) {
    throw new Error('Failed to init sessions: MongoDB client not initialized');
  }

  const rawCollection = client.db().collection('_modelenceSessions');
  await rawCollection.createIndexes([
    { key: { authToken: 1 }, unique: true },
    { key: { expiresAt: 1 }},
  ]);
  // TODO: add TTL index on expiresAt
  sessionsCollection = new MongoCollection(rawCollection);
}

export async function obtainSession(authToken: string | null): Promise<Session> {
  const existingSession = authToken ? await sessionsCollection.findOne({ authToken }) : null;

  if (existingSession) {
    return {
      authToken: String(existingSession.authToken),
      expiresAt: new Date(existingSession.expiresAt),
      userId: existingSession.userId ? String(existingSession.userId) : null,
    }
  }

  return await createSession();
}

async function createSession(): Promise<Session> {
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

export async function processSessionHeartbeat(session: Session) {
  const now = Date.now();
  const newExpiresAt = new Date(now + time.days(7));

  await sessionsCollection.updateOne({ authToken: session.authToken }, {
    $set: {
      lastActiveDate: new Date(now),
      expiresAt: newExpiresAt
    }
  });
}
