import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { Mock } from 'vitest';
import { ObjectId } from 'mongodb';

const mockRandomBytes = vi.fn(() => ({
  toString: () => 'auth-token',
}));

const mockDays = vi.fn(() => 7 * 24 * 60 * 60 * 1000);

vi.doMock('crypto', () => ({
  randomBytes: mockRandomBytes,
}));

vi.doMock('@/time', () => ({
  time: {
    days: mockDays,
  },
}));

const sessionModule = await import('./session');
const { createSession, obtainSession, setSessionUser, clearSessionUser, sessionsCollection } =
  sessionModule;

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
    expect(insertOneMock).toHaveBeenCalledWith({
      authToken: 'auth-token',
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

    expect(findOneMock).toHaveBeenCalledWith({ authToken: 'token' });
    expect(result).toEqual({
      authToken: 'token',
      expiresAt: existing.expiresAt,
      userId: existing.userId,
    });
  });

  test('obtainSession creates new session when token missing', async () => {
    findOneMock.mockResolvedValue(null as never);
    insertOneMock.mockResolvedValue({ acknowledged: true } as never);

    const result = await obtainSession(null);

    expect(insertOneMock).toHaveBeenCalled();
    expect(result.authToken).toBe('auth-token');
  });

  test('setSessionUser stores user id for session', async () => {
    updateOneMock.mockResolvedValue({ acknowledged: true } as never);
    const userId = new ObjectId();

    await setSessionUser('token', userId);

    expect(updateOneMock).toHaveBeenCalledWith(
      { authToken: 'token' },
      {
        $set: { userId },
      }
    );
  });

  test('clearSessionUser removes user reference from session', async () => {
    updateOneMock.mockResolvedValue({ acknowledged: true } as never);

    await clearSessionUser('token');

    expect(updateOneMock).toHaveBeenCalledWith(
      { authToken: 'token' },
      {
        $set: { userId: null },
      }
    );
  });
});
