import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { Mock } from 'vitest';
import { ObjectId } from 'mongodb';

const mockRandomBytes = vi.fn(() => ({
  toString: () => 'auth-token',
}));

// Input-sensitive only for the verifier values used by the exchange-code
// binding tests; every other input keeps the single fixed digest the rest of
// this suite is written against.
const VERIFIER_HASHES: Record<string, string> = {
  'right-verifier': 'hashed-right-verifier',
  'wrong-verifier': 'hashed-wrong-verifier',
};
let lastHashInput = '';
const mockDigest = vi.fn(() => VERIFIER_HASHES[lastHashInput] ?? 'hashed-auth-token');
const mockUpdate = vi.fn((value: string) => {
  lastHashInput = value;
  return { digest: mockDigest };
});
const mockCreateHash = vi.fn(() => ({ update: mockUpdate }));
const mockDays = vi.fn(() => 7 * 24 * 60 * 60 * 1000);
const mockMinutes = vi.fn((value: number) => value * 60 * 1000);

vi.doMock('crypto', () => ({
  randomBytes: mockRandomBytes,
  createHash: mockCreateHash,
  timingSafeEqual: (a: Buffer, b: Buffer) => a.equals(b),
}));

vi.doMock('@/time', () => ({
  time: {
    days: mockDays,
    minutes: mockMinutes,
  },
}));

vi.doMock('@/config/server', () => ({
  getPublicConfigs: vi.fn(() => ({})),
}));

const sessionModule = await import('./session');
const {
  createSession,
  obtainSession,
  setSessionUser,
  clearSessionUser,
  sessionsCollection,
  issueOAuthExchangeCode,
  consumeOAuthExchangeCode,
  oauthExchangeCodesCollection,
} = sessionModule;
const sessionSystemModule = sessionModule.default;

describe('auth/session', () => {
  const insertOneMock: Mock = vi.fn();
  const findOneMock: Mock = vi.fn();
  const updateOneMock: Mock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (sessionsCollection as unknown as { insertOne: typeof insertOneMock }).insertOne =
      insertOneMock;
    (sessionsCollection as unknown as { findOne: typeof findOneMock }).findOne = findOneMock;
    (sessionsCollection as unknown as { updateOne: typeof updateOneMock }).updateOne =
      updateOneMock;
  });

  test('createSession inserts session with generated token and returns metadata', async () => {
    const userId = new ObjectId();
    insertOneMock.mockResolvedValue({ acknowledged: true } as never);

    const result = await createSession(userId);

    expect((mockRandomBytes as Mock).mock.calls[0]?.[0]).toBe(32);
    expect(mockCreateHash).toHaveBeenCalledWith('sha256');
    expect(mockUpdate).toHaveBeenCalledWith('auth-token');
    expect(mockDigest).toHaveBeenCalledWith('hex');
    expect(insertOneMock).toHaveBeenCalledWith({
      authToken: 'hashed-auth-token',
      createdAt: expect.any(Date),
      expiresAt: expect.any(Date),
      userId,
    });
    expect(result.authToken).toBe('auth-token');
    expect(result.userId).toBe(userId);
    expect(result.expiresAt).toBeInstanceOf(Date);
  });

  test('obtainSession returns existing session when auth token found', async () => {
    const existing = {
      authToken: 'token',
      expiresAt: new Date(),
      userId: new ObjectId(),
    };
    findOneMock.mockResolvedValue(existing as never);

    const result = await obtainSession('token');

    // Should look up by hashed token first
    expect(findOneMock).toHaveBeenCalledWith({ authToken: 'hashed-auth-token' });
    // Returns the raw (unhashed) token to the caller
    expect(result).toEqual({
      authToken: 'token',
      expiresAt: existing.expiresAt,
      userId: existing.userId,
    });
  });

  test('obtainSession falls back to raw token lookup for legacy sessions', async () => {
    const legacy = {
      _id: new ObjectId(),
      authToken: 'legacy-raw-token',
      expiresAt: new Date(),
      userId: new ObjectId(),
    };
    // First call (hashed) returns null; second call (raw) returns legacy
    findOneMock.mockResolvedValueOnce(null as never);
    findOneMock.mockResolvedValueOnce(legacy as never);
    insertOneMock.mockResolvedValue({ acknowledged: true } as never);
    const updateOneMockLocal = vi.fn().mockResolvedValue({ acknowledged: true } as never);
    (sessionsCollection as unknown as { updateOne: typeof updateOneMockLocal }).updateOne =
      updateOneMockLocal;

    const result = await obtainSession('legacy-raw-token');

    expect(findOneMock).toHaveBeenNthCalledWith(1, { authToken: 'hashed-auth-token' });
    expect(findOneMock).toHaveBeenNthCalledWith(2, { authToken: 'legacy-raw-token' });
    // Should migrate the legacy session to hashed
    expect(updateOneMockLocal).toHaveBeenCalledWith(
      { _id: legacy._id },
      { $set: { authToken: 'hashed-auth-token' } }
    );
    expect(result).toEqual({
      authToken: 'legacy-raw-token',
      expiresAt: legacy.expiresAt,
      userId: legacy.userId,
    });
  });

  test('obtainSession creates new session when token missing', async () => {
    findOneMock.mockResolvedValue(null as never);
    insertOneMock.mockResolvedValue({ acknowledged: true } as never);

    const result = await obtainSession(null);

    expect(insertOneMock).toHaveBeenCalled();
    expect(result.authToken).toBe('auth-token');
  });

  test('obtainSession does not fall back to raw token lookup if input is a 64-char hex string (hash replay protection)', async () => {
    const leakedHash = 'a'.repeat(64);

    findOneMock.mockResolvedValue(null as never);
    insertOneMock.mockResolvedValue({ acknowledged: true } as never);

    const result = await obtainSession(leakedHash);

    // Should only look up by hashed token (which is the mock hashed token in tests)
    expect(findOneMock).toHaveBeenCalledTimes(1);
    expect(findOneMock).toHaveBeenCalledWith({ authToken: 'hashed-auth-token' });

    // Should NOT look up by the raw leakedHash string via legacy fallback
    expect(findOneMock).not.toHaveBeenCalledWith({ authToken: leakedHash });

    // Should result in a newly created session instead
    expect(insertOneMock).toHaveBeenCalled();
    expect(result.authToken).toBe('auth-token');
  });

  test('setSessionUser stores user id for session', async () => {
    updateOneMock.mockResolvedValue({ acknowledged: true } as never);
    const userId = new ObjectId();

    await setSessionUser('token', userId);

    expect(updateOneMock).toHaveBeenCalledWith(
      { authToken: 'hashed-auth-token' },
      {
        $set: { userId },
      }
    );
  });

  test('clearSessionUser removes user reference from session', async () => {
    updateOneMock.mockResolvedValue({ acknowledged: true } as never);

    await clearSessionUser('token');

    expect(updateOneMock).toHaveBeenCalledWith(
      { authToken: 'hashed-auth-token' },
      {
        $set: { userId: null },
      }
    );
  });

  describe('_system.session.init cookie refresh', () => {
    function makeRes() {
      return {
        cookie: vi.fn(),
        clearCookie: vi.fn(),
      } as unknown as import('express').Response;
    }

    test('refreshes the cookie for a logged-in session', async () => {
      const res = makeRes();
      const session = { authToken: 'real-token', expiresAt: new Date(), userId: new ObjectId() };

      await sessionSystemModule.mutations.init.call(
        sessionSystemModule,
        {},
        {
          session,
          user: { id: 'u', email: 'a@b' },
          roles: [],
          clientInfo: {} as never,
          connectionInfo: {} as never,
          res,
        }
      );

      expect(res.cookie as Mock).toHaveBeenCalledWith(
        'authToken',
        'real-token',
        expect.objectContaining({ httpOnly: true })
      );
    });

    test('does NOT write a cookie for an anonymous session', async () => {
      // Regression: an anonymous Set-Cookie would shadow the localStorage
      // token sent in the body of the reconciliation request, causing the
      // server to authenticate as anonymous and the client to overwrite
      // its real token — permanently logging the user out.
      const res = makeRes();
      const session = { authToken: 'fresh-anon-token', expiresAt: new Date(), userId: null };

      await sessionSystemModule.mutations.init.call(
        sessionSystemModule,
        {},
        {
          session,
          user: null,
          roles: [],
          clientInfo: {} as never,
          connectionInfo: {} as never,
          res,
        }
      );

      expect(res.cookie as Mock).not.toHaveBeenCalled();
    });

    test('does not throw when res is null (in-process invocations)', async () => {
      const session = { authToken: 'token', expiresAt: new Date(), userId: new ObjectId() };

      await sessionSystemModule.mutations.init.call(
        sessionSystemModule,
        {},
        {
          session,
          user: { id: 'u', email: 'a@b' },
          roles: [],
          clientInfo: {} as never,
          connectionInfo: {} as never,
          res: null,
        }
      );
    });
  });

  describe('OAuth exchange codes', () => {
    const insertMock: Mock = vi.fn();
    const findOneAndDeleteMock: Mock = vi.fn();

    beforeEach(() => {
      (oauthExchangeCodesCollection as unknown as { insertOne: typeof insertMock }).insertOne =
        insertMock;
      (
        oauthExchangeCodesCollection as unknown as {
          findOneAndDelete: typeof findOneAndDeleteMock;
        }
      ).findOneAndDelete = findOneAndDeleteMock;
    });

    test('issue stores the code hashed, never in the clear', async () => {
      const code = await issueOAuthExchangeCode('user-id', 'google', 'right-verifier');

      expect(code).toBe('auth-token');
      expect(insertMock).toHaveBeenCalledWith({
        code: 'hashed-auth-token',
        userId: 'user-id',
        provider: 'google',
        codeChallenge: 'hashed-right-verifier',
        expiresAt: expect.any(Date),
      });
      // The returned value is the credential; the stored value must differ.
      expect(insertMock.mock.calls[0][0].code).not.toBe(code);
    });

    test('issue binds the device challenge, stored hashed', async () => {
      await issueOAuthExchangeCode('user-id', 'google', 'right-verifier');

      expect(insertMock).toHaveBeenCalledWith(
        expect.objectContaining({ codeChallenge: 'hashed-right-verifier' })
      );
      // The challenge is a bearer secret until redemption, so it must not be
      // readable from the database.
      expect(insertMock.mock.calls[0][0].codeChallenge).not.toBe('right-verifier');
    });

    // Fail closed: an entry with no challenge cannot be verified, so it must be
    // refused rather than accepted unbound. Treating "no challenge" as "no check
    // needed" would let anyone able to mint an unbound code bypass the binding.
    test('consume refuses a stored entry that carries no challenge', async () => {
      findOneAndDeleteMock.mockResolvedValue({
        userId: 'user-id',
        provider: 'google',
        expiresAt: new Date(Date.now() + 60_000),
      } as never);

      expect(await consumeOAuthExchangeCode('auth-token', 'right-verifier')).toBeNull();
      expect(await consumeOAuthExchangeCode('auth-token')).toBeNull();
    });

    // The attack this closes: a code minted by an attacker's flow, delivered to
    // the victim's device via a crafted myapp://auth?code=... deep link.
    test('consume rejects a code whose challenge the verifier does not match', async () => {
      findOneAndDeleteMock.mockResolvedValue({
        userId: 'user-id',
        provider: 'google',
        codeChallenge: 'hashed-right-verifier',
        expiresAt: new Date(Date.now() + 60_000),
      } as never);

      expect(await consumeOAuthExchangeCode('auth-token', 'wrong-verifier')).toBeNull();
    });

    test('consume accepts a code whose challenge the verifier matches', async () => {
      findOneAndDeleteMock.mockResolvedValue({
        userId: 'user-id',
        provider: 'google',
        codeChallenge: 'hashed-right-verifier',
        expiresAt: new Date(Date.now() + 60_000),
      } as never);

      expect(await consumeOAuthExchangeCode('auth-token', 'right-verifier')).toEqual({
        userId: 'user-id',
        provider: 'google',
      });
    });

    test('consume rejects a bound code when no verifier is supplied', async () => {
      findOneAndDeleteMock.mockResolvedValue({
        userId: 'user-id',
        provider: 'google',
        codeChallenge: 'hashed-right-verifier',
        expiresAt: new Date(Date.now() + 60_000),
      } as never);

      expect(await consumeOAuthExchangeCode('auth-token')).toBeNull();
    });

    // A wrong verifier still burns the code, so it cannot be guessed at twice.
    test('consume burns the code even when the verifier is wrong', async () => {
      findOneAndDeleteMock.mockResolvedValue({
        userId: 'user-id',
        provider: 'google',
        codeChallenge: 'hashed-right-verifier',
        expiresAt: new Date(Date.now() + 60_000),
      } as never);

      await consumeOAuthExchangeCode('auth-token', 'wrong-verifier');

      expect(findOneAndDeleteMock).toHaveBeenCalledTimes(1);
    });

    test('issue uses a one-minute TTL', async () => {
      await issueOAuthExchangeCode('user-id', 'google', 'right-verifier');

      expect(mockMinutes).toHaveBeenCalledWith(1);
    });

    test('consume looks up by hash and returns the binding', async () => {
      findOneAndDeleteMock.mockResolvedValue({
        userId: 'user-id',
        provider: 'github',
        codeChallenge: 'hashed-right-verifier',
        expiresAt: new Date(Date.now() + 60_000),
      } as never);

      const result = await consumeOAuthExchangeCode('auth-token', 'right-verifier');

      expect(findOneAndDeleteMock).toHaveBeenCalledWith({ code: 'hashed-auth-token' });
      expect(result).toEqual({ userId: 'user-id', provider: 'github' });
    });

    test('consume returns null for an unknown or already-redeemed code', async () => {
      findOneAndDeleteMock.mockResolvedValue(null as never);

      expect(await consumeOAuthExchangeCode('auth-token')).toBeNull();
    });

    // The TTL index only sweeps periodically, so expiry is enforced on read too.
    test('consume rejects an expired code the TTL index has not swept yet', async () => {
      findOneAndDeleteMock.mockResolvedValue({
        userId: 'user-id',
        provider: 'google',
        expiresAt: new Date(Date.now() - 1000),
      } as never);

      expect(await consumeOAuthExchangeCode('auth-token')).toBeNull();
    });

    test('consume deletes the code, making it single-use', async () => {
      findOneAndDeleteMock.mockResolvedValue({
        userId: 'user-id',
        provider: 'google',
        expiresAt: new Date(Date.now() + 60_000),
      } as never);

      await consumeOAuthExchangeCode('auth-token');

      // findOneAndDelete is the atomic commit point: a concurrent second
      // redemption finds nothing.
      expect(findOneAndDeleteMock).toHaveBeenCalledTimes(1);
    });
  });
});
