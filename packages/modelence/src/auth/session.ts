import { randomBytes } from 'crypto';
import { ObjectId } from 'mongodb';
import { Module } from '../app/module';
import { getPublicConfigs } from '../config/server';
import { Store } from '../data/store';
import { schema } from '../data/types';
import { time } from '../time';
import { Session } from './types';

export const sessionsCollection = new Store('_modelenceSessions', {
  schema: {
    authToken: schema.string(),
    createdAt: schema.date(),
    expiresAt: schema.date(),
    lastActiveDate: schema.date().optional(),
    userId: schema.userId().nullable(),
  },
  indexes: [
    { key: { authToken: 1 }, unique: true },
    { key: { expiresAt: 1 } },
    { key: { lastActiveDate: 1 } },
    { key: { userId: 1, lastActiveDate: -1 } },
  ],
  // TODO: add TTL index on expiresAt
});

export async function obtainSession(authToken: string | null): Promise<Session> {
  const existingSession = authToken ? await sessionsCollection.findOne({ authToken }) : null;

  if (existingSession) {
    return {
      authToken: String(existingSession.authToken),
      expiresAt: new Date(existingSession.expiresAt),
      userId: existingSession.userId ?? null,
    };
  }

  return await createSession();
}

export async function setSessionUser(authToken: string, userId: ObjectId) {
  await sessionsCollection.updateOne(
    { authToken },
    {
      $set: { userId },
    }
  );
}

export async function clearSessionUser(authToken: string) {
  await sessionsCollection.updateOne(
    { authToken },
    {
      $set: { userId: null },
    }
  );
}

export async function createSession(userId: ObjectId | null = null): Promise<Session> {
  // TODO: add rate-limiting and captcha handling

  const authToken = randomBytes(32).toString('base64url');
  const now = Date.now();
  const expiresAt = new Date(now + time.days(7));

  await sessionsCollection.insertOne({
    authToken,
    createdAt: new Date(now),
    expiresAt,
    userId,
  });

  return {
    authToken,
    expiresAt,
    userId,
  };
}

async function processSessionHeartbeat(session: Session) {
  const now = Date.now();
  const newExpiresAt = new Date(now + time.days(7));

  await sessionsCollection.updateOne(
    { authToken: session.authToken },
    {
      $set: {
        lastActiveDate: new Date(now),
        expiresAt: newExpiresAt,
      },
    }
  );
}

export default new Module('_system.session', {
  stores: [sessionsCollection],
  mutations: {
    init: async function (args, { session, user }) {
      // TODO: mark or track app load somewhere

      return {
        session,
        user,
        configs: getPublicConfigs(),
      };
    },
    heartbeat: async function (args, { session }) {
      // Session might not exist if there is no database/authentication setup
      if (session) {
        await processSessionHeartbeat(session);
      }
    },
  },
});
