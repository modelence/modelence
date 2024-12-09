import { randomBytes } from 'crypto';
import { time } from '../time';
import { Session } from './types';
import { getPublicConfigs } from '../config/server';
import { Module } from '../app/module';
import { Store } from '../data/store';
import { SchemaTypes } from '../data/types';
import { ObjectId } from 'mongodb';

type DataType = {
  authToken: string;
  createdAt: Date;
  expiresAt: Date;
  userId: ObjectId | null;
};

export const sessionsCollection = new Store<DataType>('_modelenceSessions', {
  schema: {
    authToken: SchemaTypes.String,
    createdAt: SchemaTypes.Date,
    expiresAt: SchemaTypes.Date,
    userId: SchemaTypes.ObjectId,
  },
  indexes: [
    { key: { authToken: 1 }, unique: true },
    { key: { expiresAt: 1 }},
  ]
  // TODO: add TTL index on expiresAt
});

export async function obtainSession(authToken: string | null): Promise<Session> {
  const existingSession = authToken ? await sessionsCollection.findOne({ authToken }) : null;

  if (existingSession) {
    return {
      authToken: String(existingSession.authToken),
      expiresAt: new Date(existingSession.expiresAt),
      userId: existingSession.userId ?? null,
    }
  }

  return await createSession();
}

export async function setSessionUser(authToken: string, userId: ObjectId) {
  await sessionsCollection.updateOne({ authToken }, {
    $set: { userId }
  });
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

async function processSessionHeartbeat(session: Session) {
  const now = Date.now();
  const newExpiresAt = new Date(now + time.days(7));

  await sessionsCollection.updateOne({ authToken: session.authToken }, {
    $set: {
      lastActiveDate: new Date(now),
      expiresAt: newExpiresAt
    }
  });
}

export default new Module('_system.session', {
  stores: [sessionsCollection],
  mutations: {
    init: async function(args, { session, user }) {
      // TODO: mark or track app load somewhere
  
      return {
        session,
        user,
        configs: getPublicConfigs(),
      };
    },
    heartbeat: async function(args, { session }) {
      // Session might not exist if there is no database/authentication setup
      if (session) {
        await processSessionHeartbeat(session);
      }
    }
  },
});
