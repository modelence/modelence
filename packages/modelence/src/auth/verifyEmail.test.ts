import { ObjectId } from 'mongodb';
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Module } from '../app/module';
import * as authConfig from '../app/authConfig';
import { setCallMethodTransport } from '../client/method';
import { _createSystemMutation, runMethod } from '../methods';
import type { Context } from '../methods/types';
import { emailVerificationTokensCollection, usersCollection } from './db';
import * as sessions from './session';
import { hashToken } from './tokenHash';
import type { User } from './types';
import userModule from './user';
import { verifyEmail } from './client';

const methodName = '_system.user.verifyEmail';
const token = 'verification-token';
const userId = new ObjectId('507f1f77bcf86cd799439011');
const callerId = new ObjectId('507f1f77bcf86cd799439012');
const onAfterEmailVerification = vi.fn();
const onEmailVerificationError = vi.fn();
type VerificationToken = typeof emailVerificationTokensCollection.Doc;

describe('verifyEmail server mutation', () => {
  let user: User;
  let context: Context;
  let restoreTransport: () => void;
  let tokenDoc: VerificationToken | null;

  beforeAll(() => {
    // Register the real module definitions through the same registry used at startup.
    for (const [name, handler] of Object.entries((userModule as Module).mutations)) {
      _createSystemMutation(`${userModule.name}.${name}`, handler);
    }
  });

  beforeEach(() => {
    vi.clearAllMocks();
    user = {
      _id: userId,
      handle: 'verified-user',
      status: 'active',
      createdAt: new Date(),
      authMethods: {},
      emails: [{ address: 'user@example.com', verified: false }],
    };
    tokenDoc = {
      _id: new ObjectId(),
      userId,
      email: 'user@example.com',
      token: hashToken(token),
      hashed: true,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    } as VerificationToken;
    context = {
      user: null,
      session: null,
      roles: [],
      connectionInfo: { ip: '192.0.2.1', baseUrl: 'https://example.com' },
      clientInfo: {
        screenWidth: 1024,
        screenHeight: 768,
        windowWidth: 1024,
        windowHeight: 768,
        pixelRatio: 1,
        orientation: null,
      },
      req: null,
      res: null,
    };

    vi.spyOn(authConfig, 'getAuthConfig').mockReturnValue({
      onAfterEmailVerification,
      onEmailVerificationError,
    });
    vi.spyOn(emailVerificationTokensCollection, 'findOne').mockImplementation(async (filter) => {
      if (!tokenDoc || tokenDoc.token !== filter.token) return null;
      const excludesHashed = (filter.hashed as { $ne?: boolean } | undefined)?.$ne === true;
      if (excludesHashed && tokenDoc.hashed === true) return null;
      const expiresAfter = (filter.expiresAt as { $gt?: Date } | undefined)?.$gt;
      return expiresAfter && tokenDoc.expiresAt <= expiresAfter ? null : tokenDoc;
    });
    vi.spyOn(emailVerificationTokensCollection, 'updateOne').mockImplementation(
      async (_filter, update) => {
        const usedAt = (update as { $set?: { usedAt?: Date } }).$set?.usedAt;
        if (tokenDoc && usedAt) tokenDoc = { ...tokenDoc, usedAt } as VerificationToken;
        return { acknowledged: true, matchedCount: 1, modifiedCount: 1 } as never;
      }
    );
    vi.spyOn(usersCollection, 'findOne').mockImplementation(async () =>
      user.status === 'disabled' || user.status === 'deleted' ? null : user
    );
    vi.spyOn(usersCollection, 'findOneAndUpdate').mockImplementation(async () => {
      user.emails![0].verified = true;
      return user;
    });
    vi.spyOn(sessions, 'createSession').mockImplementation(async () => {
      throw new Error('Email verification must not create a login session');
    });
    vi.spyOn(sessions, 'setAuthTokenCookie').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    restoreTransport = setCallMethodTransport(
      async <T>(name: string, args: Record<string, unknown>) =>
        (await runMethod(name, args, context)) as T
    );
  });

  afterEach(() => {
    restoreTransport();
    vi.restoreAllMocks();
  });

  test.each(['anonymous', 'authenticated'])(
    'verifies an email without changing the %s caller session',
    async (caller) => {
      if (caller === 'authenticated') {
        context.session = {
          authToken: 'existing-caller-token',
          userId: callerId,
          expiresAt: new Date(Date.now() + 60_000),
        };
        context.user = {
          id: callerId.toString(),
          handle: 'caller',
          roles: [],
          hasRole: () => false,
          requireRole: () => {},
        };
      }
      const originalSession = context.session;
      const tokenId = tokenDoc!._id;

      await expect(verifyEmail({ token })).resolves.toBeUndefined();

      expect(user.emails?.[0].verified).toBe(true);
      expect(emailVerificationTokensCollection.updateOne).toHaveBeenCalledWith(
        { _id: tokenId },
        { $set: { usedAt: expect.any(Date) } }
      );
      expect(tokenDoc?.usedAt).toBeInstanceOf(Date);
      expect(onAfterEmailVerification).toHaveBeenCalledWith({
        provider: 'email',
        user,
        session: null,
        connectionInfo: context.connectionInfo,
      });
      expect(onEmailVerificationError).not.toHaveBeenCalled();
      expect(sessions.createSession).not.toHaveBeenCalled();
      expect(sessions.setAuthTokenCookie).not.toHaveBeenCalled();
      expect(context.session).toBe(originalSession);
      expect(context.session?.userId).toEqual(caller === 'authenticated' ? callerId : undefined);
      expect(context.user?.id).toBe(caller === 'authenticated' ? callerId.toString() : undefined);
    }
  );

  test('reports verification errors without passing the caller session to the hook', async () => {
    const callerSession = {
      authToken: 'existing-caller-token',
      userId: callerId,
      expiresAt: new Date(Date.now() + 60_000),
    };
    context.session = callerSession;

    await expect(verifyEmail({ token: 'unknown-token' })).rejects.toThrow(
      'Invalid or expired verification token'
    );

    expect(onEmailVerificationError).toHaveBeenCalledWith({
      provider: 'email',
      error: expect.objectContaining({ message: 'Invalid or expired verification token' }),
      session: null,
      connectionInfo: context.connectionInfo,
    });
    expect(context.session).toBe(callerSession);
    expect(onAfterEmailVerification).not.toHaveBeenCalled();
    expect(sessions.createSession).not.toHaveBeenCalled();
    expect(sessions.setAuthTokenCookie).not.toHaveBeenCalled();
  });

  test.each(['unknown', 'expired'])(
    'rejects an %s token and reports the error hook',
    async (kind) => {
      if (kind === 'expired') tokenDoc!.expiresAt = new Date(Date.now() - 1_000);

      await expect(
        runMethod(methodName, { token: kind === 'unknown' ? 'unknown-token' : token }, context)
      ).rejects.toThrow('Invalid or expired verification token');

      expect(onEmailVerificationError).toHaveBeenCalledWith({
        provider: 'email',
        error: expect.objectContaining({ message: 'Invalid or expired verification token' }),
        session: null,
        connectionInfo: context.connectionInfo,
      });
      expect(usersCollection.findOneAndUpdate).not.toHaveBeenCalled();
      expect(onAfterEmailVerification).not.toHaveBeenCalled();
    }
  );

  test.each([undefined, 123, ''])(
    'rejects malformed token %s before database access',
    async (value) => {
      await expect(runMethod(methodName, { token: value }, context)).rejects.toMatchObject({
        name: 'ZodError',
      });
      expect(emailVerificationTokensCollection.findOne).not.toHaveBeenCalled();
      expect(onEmailVerificationError).toHaveBeenCalledOnce();
    }
  );

  test('accepts a token again after it verified the address, without re-verifying', async () => {
    // A mail scanner may spend the link before the user opens it.
    await runMethod(methodName, { token }, context);
    await expect(runMethod(methodName, { token }, context)).resolves.toBeUndefined();
    expect(usersCollection.findOneAndUpdate).toHaveBeenCalledOnce();
    expect(onAfterEmailVerification).toHaveBeenCalledOnce();
    expect(onEmailVerificationError).not.toHaveBeenCalled();
  });

  test('stores nothing that works as a token: the stored hash is rejected', async () => {
    await expect(runMethod(methodName, { token: hashToken(token) }, context)).rejects.toThrow(
      'Invalid or expired verification token'
    );
    expect(user.emails?.[0].verified).toBe(false);
    expect(usersCollection.findOneAndUpdate).not.toHaveBeenCalled();
  });

  test('verifies a link sent before tokens were hashed', async () => {
    tokenDoc = { ...tokenDoc!, token, hashed: undefined } as VerificationToken;

    await expect(runMethod(methodName, { token }, context)).resolves.toBeUndefined();

    expect(user.emails?.[0].verified).toBe(true);
    expect(onAfterEmailVerification).toHaveBeenCalledOnce();
  });

  test.each(['disabled', 'deleted'] as const)(
    'rejects verification for a %s user',
    async (status) => {
      user.status = status;
      await expect(runMethod(methodName, { token }, context)).rejects.toThrow('User not found');
      expect(usersCollection.findOne).toHaveBeenCalledWith({
        _id: userId,
        status: { $nin: ['deleted', 'disabled'] },
      });
      expect(user.emails?.[0].verified).toBe(false);
      expect(usersCollection.findOneAndUpdate).not.toHaveBeenCalled();
      expect(onAfterEmailVerification).not.toHaveBeenCalled();
      expect(onEmailVerificationError).toHaveBeenCalledOnce();
    }
  );
});
