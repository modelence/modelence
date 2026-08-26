import { randomBytes } from 'crypto';
import { type Response } from 'express';
import { ObjectId } from 'mongodb';
import { Module } from '../app/module';
import { isSetupRequired } from '../app/setupStatus';
import { getPublicConfigs } from '../config/server';
import { Store } from '../data/store';
import { schema } from '../data/types';
import { time } from '../time';
import { hashToken } from './tokenHash';
import { OAuthProvider, Session } from './types';

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

/**
 * Short-lived, single-use codes that hand an OAuth sign-in back to a native app.
 *
 * The mobile OAuth callback cannot set a usable cookie (no shared cookie jar) and
 * must not put the session token in the deep link: a custom scheme like `myapp://`
 * can be claimed by any installed app, so a token in the URL is handed to whichever
 * app wins the race. Instead the callback mints one of these codes, and the app
 * exchanges it for a real session over TLS via the `loginWithOAuth` mutation.
 *
 * Stored hashed — like magic link tokens, and unlike link nonces — because the code
 * travels in a URL and is a bearer credential until redeemed. The TTL is deliberately
 * much shorter than a link nonce's: the app is foregrounded by the deep link and
 * redeems immediately.
 */
export const oauthExchangeCodesCollection = new Store('_modelenceOAuthExchangeCodes', {
  schema: {
    code: schema.string(),
    userId: schema.string(),
    provider: schema.string(),
    expiresAt: schema.date(),
  },
  indexes: [
    { key: { code: 1 }, unique: true },
    { key: { expiresAt: 1 }, expireAfterSeconds: 0 },
  ],
});

const OAUTH_EXCHANGE_CODE_TTL_MINUTES = 1;

export async function issueOAuthExchangeCode(
  userId: string,
  provider: OAuthProvider
): Promise<string> {
  const code = randomBytes(32).toString('hex');
  await oauthExchangeCodesCollection.insertOne({
    code: hashToken(code),
    userId,
    provider,
    expiresAt: new Date(Date.now() + time.minutes(OAUTH_EXCHANGE_CODE_TTL_MINUTES)),
  });
  return code;
}

/**
 * Consumes a single-use OAuth exchange code; returns the bound user and provider,
 * or null when the code is unknown, already redeemed, or expired.
 *
 * The delete is the commit point: concurrent redemptions of the same code resolve
 * to exactly one winner. Expiry is checked explicitly rather than relying on the
 * TTL index, which only sweeps periodically.
 */
export async function consumeOAuthExchangeCode(
  code: string
): Promise<{ userId: string; provider: OAuthProvider } | null> {
  const entry = await oauthExchangeCodesCollection.findOneAndDelete({ code: hashToken(code) });
  if (!entry) return null;
  if (entry.expiresAt < new Date()) return null;
  return { userId: entry.userId, provider: entry.provider as OAuthProvider };
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
  if (authToken) {
    const hashedToken = hashToken(authToken);
    let existingSession = await sessionsCollection.findOne({ authToken: hashedToken });

    // Legacy fallback: try raw token lookup (pre-hash sessions)
    // Ensure the authToken is not a hex-encoded SHA-256 hash to prevent
    // replay attacks using leaked hashed tokens.
    const isHex64 = /^[0-9a-f]{64}$/i.test(authToken);
    if (!existingSession && !isHex64) {
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
  stores: [sessionsCollection, linkNoncesCollection, oauthExchangeCodesCollection],
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
        // Only ever true in development (see isSetupRequired); rides on the
        // init payload so the client learns it without an extra request and
        // without consulting its own build mode.
        ...(isSetupRequired() ? { setupRequired: true } : {}),
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
