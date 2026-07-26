import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { Mock } from 'vitest';
import { ObjectId } from 'mongodb';

const mockRandomBytes = vi.fn(() => ({
  toString: () => 'auth-token',
}));

const mockDigest = vi.fn(() => 'hashed-auth-token');
const mockUpdate = vi.fn(() => ({ digest: mockDigest }));
const mockCreateHash = vi.fn(() => ({ update: mockUpdate }));
const mockDays = vi.fn(() => 7 * 24 * 60 * 60 * 1000);

vi.doMock('crypto', () => ({
  randomBytes: mockRandomBytes,
  createHash: mockCreateHash,
}));

vi.doMock('@/time', () => ({
  time: {
    days: mockDays,
  },
}));

vi.doMock('@/config/server', () => ({
  getPublicConfigs: vi.fn(() => ({})),
}));

const sessionModule = await import('./session');
const { createSession, obtainSession, setSessionUser, clearSessionUser, sessionsCollection } =
  sessionModule;
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
});
