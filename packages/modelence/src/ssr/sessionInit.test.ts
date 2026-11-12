import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { Request, Response } from 'express';
import type { Module } from '@/app/module';

vi.mock('@/db/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/db/client')>()),
  getMongodbUri: vi.fn(() => 'mongodb://localhost/test'),
}));

vi.mock('@/config/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/config/server')>()),
  getPublicConfigs: vi.fn(() => ({})),
}));

const { getCallContext } = await import('@/app/server');
const { _createSystemMutation } = await import('@/methods');
const sessionModule = await import('@/auth/session');
const { callInProcessMethod } = await import('./callInProcess');

const { sessionsCollection, isSessionSaved } = sessionModule;

// Register the session methods the same way the app does at startup.
const sessionMethods: Module = sessionModule.default;
for (const [key, handler] of Object.entries(sessionMethods.mutations)) {
  _createSystemMutation(`${sessionMethods.name}.${key}`, handler);
}

type SessionPayload = { session: { authToken: string } };

function createRequest(body: Record<string, unknown>): Request {
  return {
    path: '/',
    cookies: {},
    body,
    headers: { host: 'localhost:3000' },
    protocol: 'http',
    get: () => undefined,
  } as unknown as Request;
}

// Unsaved sessions are tracked by object identity, so this runs the real path
// SSR takes: getCallContext builds the context and the in-process init call
// must receive that same session object. If anything on the way copies the
// session, init would skip the insert and hand out a token with no record.
describe('SSR session init from getCallContext', () => {
  const insertOne = vi.fn();
  const findOne = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    insertOne.mockResolvedValue({ acknowledged: true });
    findOne.mockResolvedValue(null);
    Object.assign(sessionsCollection, { insertOne, findOne });
  });

  test.each([
    ['missing', {}],
    ['unknown', { authToken: 'bogus-token' }],
  ])('saves the session once when the token is %s', async (_label, body) => {
    const context = await getCallContext(createRequest(body), {} as Response);

    expect(context.session).not.toBeNull();
    expect(isSessionSaved(context.session!)).toBe(false);
    expect(insertOne).not.toHaveBeenCalled();

    const payload = await callInProcessMethod<SessionPayload>('_system.session.init', {}, context);

    expect(insertOne).toHaveBeenCalledTimes(1);
    expect(payload.session.authToken).toBe(context.session!.authToken);
    expect(isSessionSaved(context.session!)).toBe(true);
  });
});
