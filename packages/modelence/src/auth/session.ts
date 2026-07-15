import { randomBytes } from 'crypto';
import { type Response } from 'express';
import { ObjectId } from 'mongodb';
import { Module } from '../app/module';
import { getPublicConfigs } from '../config/server';
import { Store } from '../data/store';
import { schema } from '../data/types';
import { time } from '../time';
import { hashToken } from './tokenHash';
import { Session } from './types';

export const linkNoncesCollection = new Store('_modelenceLinkNonces', {
  schema: {
    nonce: schema.string(),
    userId: schema.string(),
    expiresAt: schema.date(),
  },
  indexes: [
    { key: { nonce: 1 }, unique: true },
    { key: { expiresAt: 1 }, expireAfterSeconds: 0 },
  ],
});

export async function issueLinkNonce(userId: string): Promise<string> {
  const nonce = randomBytes(32).toString('hex');
  await linkNoncesCollection.insertOne({
    nonce,
    userId,
    expiresAt: new Date(Date.now() + time.minutes(10)),
  });
  return nonce;
}

export async function consumeLinkNonce(nonce: string): Promise<string | null> {
  const entry = await linkNoncesCollection.findOneAndDelete({ nonce });
  if (!entry) return null;
  return entry.userId;
}

export const sessionsCollection = new Store('_modelenceSessions', {
  schema: {
    authToken: schema.string(),
    createdAt: schema.date(),
    expiresAt: schema.date(),
    userId: schema.userId().nullable(),
  },
  indexes: [
    { key: { authToken: 1 }, unique: true },
    { key: { expiresAt: 1 }, expireAfterSeconds: 0 },
    { key: { userId: 1 } },
  ],
});

export async function obtainSession(authToken: string | null): Promise<Session> {
  const hashedToken = authToken ? hashToken(authToken) : null;

  let existingSession = hashedToken
    ? await sessionsCollection.findOne({ authToken: hashedToken })
    : null;

  // Legacy fallback: try raw token lookup (pre-hash sessions)
  if (!existingSession && authToken) {
    existingSession = await sessionsCollection.findOne({ authToken });
    if (existingSession) {
      await sessionsCollection.updateOne(
        { _id: existingSession._id as ObjectId },
        { $set: { authToken: hashedToken } }
      );
    }
  }

  if (existingSession) {
    return {
      authToken,
      expiresAt: new Date(existingSession.expiresAt),
      userId: existingSession.userId ?? null,
    };
  }

  return await createSession();
}

export async function setSessionUser(authToken: string, userId: ObjectId) {
  await sessionsCollection.updateOne(
    { authToken: hashToken(authToken) },
    {
      $set: { userId },
    }
  );
}

export async function clearSessionUser(authToken: string) {
  await sessionsCollection.updateOne(
    { authToken: hashToken(authToken) },
    {
      $set: { userId: null },
    }
  );
}

export async function invalidateAllUserSessions(userId: ObjectId) {
  await sessionsCollection.deleteMany({ userId });
}

export async function createSession(userId: ObjectId | null = null): Promise<Session> {
  // TODO: add rate-limiting and captcha handling

  const authToken = randomBytes(32).toString('base64url');
  const now = Date.now();
  const expiresAt = new Date(now + time.days(7));

  await sessionsCollection.insertOne({
    authToken: hashToken(authToken),
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
    { authToken: hashToken(session.authToken) },
    {
      $set: {
        lastActiveDate: new Date(now),
        expiresAt: newExpiresAt,
      },
    }
  );
}

export function setAuthTokenCookie(res: Response, authToken: string) {
  res.cookie('authToken', authToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: time.days(7),
  });
}

export function clearAuthTokenCookie(res: Response) {
  res.clearCookie('authToken', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  });
}

export default new Module('_system.session', {
  stores: [sessionsCollection, linkNoncesCollection],
  mutations: {
    init: async function (args, { session, user, res }) {
      // Only refresh the cookie for logged-in sessions. Writing one for a
      // freshly-minted anonymous session creates a Set-Cookie that the
      // browser then attaches to the client's reconciliation request,
      // shadowing the localStorage token sent in the body — see
      // getCallContext's `cookie || body.authToken` precedence.
      if (res && session?.userId) {
        setAuthTokenCookie(res, session.authToken);
      }

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
