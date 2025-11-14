import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import type { Request, Response, NextFunction } from 'express';

const mockAuthenticate = jest.fn();
const mockGetMongodbUri = jest.fn();
const mockStartTransaction = jest.fn();

jest.unstable_mockModule('../auth', () => ({
  authenticate: mockAuthenticate,
}));

jest.unstable_mockModule('../db/client', () => ({
  getMongodbUri: mockGetMongodbUri,
  getClient: jest.fn(),
  connect: jest.fn(),
}));

jest.unstable_mockModule('../telemetry', () => ({
  startTransaction: mockStartTransaction,
}));

const { ValidationError } = await import('../error');
const { createRouteHandler } = await import('./handler');

describe('routes/handler', () => {
  const transactionEnd = jest.fn();

  const createRequest = (): Request =>
    ({
      headers: {},
      query: {},
      body: {},
      params: {},
      cookies: {},
      path: '/test',
    }) as unknown as Request;

  const createResponse = (): Response => {
    const response = {
      status: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
      redirect: jest.fn(),
      setHeader: jest.fn(),
    } satisfies Partial<Response>;

    return response as Response;
  };

  const baseReq = createRequest();
  let res: Response;
  let next: NextFunction;

  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthenticate.mockResolvedValue({ session: null, user: null } as never);
    mockGetMongodbUri.mockReturnValue(undefined);
    mockStartTransaction.mockImplementation(() => ({
      end: transactionEnd,
      setContext: jest.fn(),
    }));
    res = createResponse();
    next = jest.fn() as NextFunction;
  });

  test('executes handler with authenticated context', async () => {
    mockGetMongodbUri.mockReturnValue('mongodb://localhost');
    mockAuthenticate.mockResolvedValue({
      session: { authToken: 'token', expiresAt: new Date(), userId: null },
      user: { id: '1', handle: 'testuser', roles: [], hasRole: jest.fn(), requireRole: jest.fn() },
      roles: [],
    } as never);

    const handler = createRouteHandler('GET', '/test', async () => ({
      status: 200,
      data: { ok: true },
    }));

    const authedReq = {
      ...baseReq,
      headers: { 'x-modelence-auth-token': 'token' },
    } as Request;

    await handler(authedReq, res, next);

    expect(mockAuthenticate).toHaveBeenCalledWith('token');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ ok: true });
    expect(transactionEnd).toHaveBeenCalledWith();
  });

  test('handles ModelenceError gracefully', async () => {
    const handler = createRouteHandler('GET', '/test', async () => {
      throw new ValidationError('fail');
    });

    await handler(baseReq, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.send).toHaveBeenCalledWith('fail');
  });

  test('logs generic errors and sends 500', async () => {
    const handler = createRouteHandler('GET', '/test', async () => {
      throw new Error('boom');
    });

    await handler(baseReq, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).toHaveBeenCalledWith('Error: boom');
    expect(transactionEnd).toHaveBeenCalledWith('error');
  });
});
