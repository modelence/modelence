import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

const mockAuthenticate = vi.fn();
const mockGetMongodbUri = vi.fn();
const mockStartTransaction = vi.fn();
const mockCaptureError = vi.fn();
const mockLogError = vi.fn();

vi.doMock('../auth', () => ({
  authenticate: mockAuthenticate,
}));

vi.doMock('../db/client', () => ({
  getMongodbUri: mockGetMongodbUri,
  getClient: vi.fn(),
  connect: vi.fn(),
}));

// Faithful copy of the real redactSensitive (kept in sync with telemetry/index.ts)
// so the redaction test exercises the same logic without pulling APM deps.
const SENSITIVE_KEYS = ['token', 'password', 'secret', 'nonce', 'code'];
function redactSensitive(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(redactSensitive);
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    result[key] = SENSITIVE_KEYS.some((k) => key.toLowerCase().includes(k))
      ? '[redacted]'
      : redactSensitive(val);
  }
  return result;
}

vi.doMock('../telemetry', () => ({
  startTransaction: mockStartTransaction,
  redactSensitive,
  captureError: mockCaptureError,
  logError: mockLogError,
}));

const { ValidationError } = await import('../error');
const { createRouteHandler } = await import('./handler');

describe('routes/handler', () => {
  const transactionEnd = vi.fn();

  const createRequest = (overrides?: Partial<Request>): Request =>
    ({
      headers: {},
      query: {},
      body: {},
      params: {},
      cookies: {},
      path: '/test',
      ...overrides,
    }) as unknown as Request;

  const createResponse = (): Response => {
    const response = {
      status: vi.fn<(code: number) => Response>().mockReturnThis(),
      send: vi.fn<(body?: unknown) => Response>().mockReturnThis(),
      redirect: vi.fn(),
      setHeader: vi
        .fn<(name: string, value: string | number | readonly string[]) => Response>()
        .mockReturnThis(),
    } satisfies Partial<Response>;

    return response as unknown as Response;
  };

  const baseReq = createRequest();
  let res: Response;
  let next: NextFunction;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue({ session: null, user: null } as never);
    mockGetMongodbUri.mockReturnValue(undefined);
    mockStartTransaction.mockImplementation(() => ({
      end: transactionEnd,
      setContext: vi.fn(),
    }));
    res = createResponse();
    next = vi.fn() as NextFunction;
  });

  test('executes handler with authenticated context', async () => {
    mockGetMongodbUri.mockReturnValue('mongodb://localhost');
    mockAuthenticate.mockResolvedValue({
      session: { authToken: 'token', expiresAt: new Date(), userId: null },
      user: { id: '1', handle: 'testuser', roles: [], hasRole: vi.fn(), requireRole: vi.fn() },
      roles: [],
    } as never);

    const handler = createRouteHandler('GET', '/test', async () => ({
      status: 200,
      data: { ok: true },
    }));

    const authedReq = createRequest({ headers: { 'x-modelence-auth-token': 'token' } });

    await handler(authedReq, res, next);

    expect(mockAuthenticate).toHaveBeenCalledWith('token', { persistNewSession: false });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ ok: true });
    expect(transactionEnd).toHaveBeenCalledWith();
  });

  test.each([
    { source: 'cookie', request: { cookies: { authToken: 'cookie-token' } } },
    { source: 'bearer', request: { headers: { authorization: 'Bearer bearer-token' } } },
  ])('authenticates custom routes via $source token', async ({ request }) => {
    mockGetMongodbUri.mockReturnValue('mongodb://localhost');
    const handler = createRouteHandler('GET', '/test', async () => ({
      status: 200,
      data: { ok: true },
    }));

    await handler(createRequest(request as Partial<Request>), res, next);

    const expectedToken =
      request.cookies?.authToken ??
      (request.headers?.authorization?.startsWith('Bearer ')
        ? request.headers.authorization.slice(7).trim()
        : undefined);
    expect(mockAuthenticate).toHaveBeenCalledWith(expectedToken);
  });

  test('prefers x-modelence-auth-token over cookie and bearer tokens', async () => {
    mockGetMongodbUri.mockReturnValue('mongodb://localhost');
    const handler = createRouteHandler('GET', '/test', async () => ({
      status: 200,
      data: { ok: true },
    }));

    await handler(
      createRequest({
        headers: {
          'x-modelence-auth-token': 'header-token',
          authorization: 'Bearer bearer-token',
        },
        cookies: { authToken: 'cookie-token' },
      }),
      res,
      next
    );

    expect(mockAuthenticate).toHaveBeenCalledWith('header-token');
  });

  test('redacts secrets from the telemetry transaction context', async () => {
    const handler = createRouteHandler('GET', '/landing', async () => ({ status: 200 }));
    const req = createRequest({
      query: { token: 'raw-secret', status: 'ok' } as never,
      body: { password: 'hunter2', email: 'a@b.com' } as never,
      params: { linkNonce: 'nonce-value' } as never,
    });

    await handler(req, res, next);

    const ctx = mockStartTransaction.mock.calls[0][2] as {
      query: Record<string, unknown>;
      body: Record<string, unknown>;
      params: Record<string, unknown>;
    };
    // Sensitive keys redacted...
    expect(ctx.query.token).toBe('[redacted]');
    expect(ctx.body.password).toBe('[redacted]');
    expect(ctx.params.linkNonce).toBe('[redacted]');
    // ...non-sensitive values preserved.
    expect(ctx.query.status).toBe('ok');
    expect(ctx.body.email).toBe('a@b.com');
  });

  test('applies custom headers before redirecting and does not send a body', async () => {
    const handler = createRouteHandler('GET', '/landing', async () => ({
      status: 302,
      headers: { 'Referrer-Policy': 'no-referrer' },
      redirect: '/destination',
    }));

    await handler(baseReq, res, next);

    expect(res.status).toHaveBeenCalledWith(302);
    // Header must be set before redirect flushes the response, otherwise it is lost.
    const setHeaderOrder = (res.setHeader as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
    const redirectOrder = (res.redirect as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
    expect(res.setHeader).toHaveBeenCalledWith('Referrer-Policy', 'no-referrer');
    expect(setHeaderOrder).toBeLessThan(redirectOrder);
    expect(res.redirect).toHaveBeenCalledWith(302, '/destination');
    expect(res.send).not.toHaveBeenCalled();
  });

  test.each([301, 303, 307, 308])('keeps a %i status on redirects', async (status) => {
    const handler = createRouteHandler('GET', '/old', async () => ({
      status,
      redirect: '/new',
    }));

    await handler(baseReq, res, next);

    expect(res.redirect).toHaveBeenCalledWith(status, '/new');
  });

  test('redirects with 302 when no redirect status is given', async () => {
    const handler = createRouteHandler('GET', '/old', async () => ({ redirect: '/new' }));

    await handler(baseReq, res, next);

    expect(res.redirect).toHaveBeenCalledWith(302, '/new');
  });

  test('applies custom headers on a non-redirect response', async () => {
    const handler = createRouteHandler('GET', '/test', async () => ({
      status: 200,
      headers: { 'X-Custom': 'value' },
      data: { ok: true },
    }));

    await handler(baseReq, res, next);

    expect(res.setHeader).toHaveBeenCalledWith('X-Custom', 'value');
    expect(res.send).toHaveBeenCalledWith({ ok: true });
  });

  test('applies contentType before sending the response body', async () => {
    const handler = createRouteHandler('GET', '/report', async () => ({
      data: 'name,email\nAda,ada@example.com',
      contentType: 'text/csv; charset=utf-8',
    }));

    await handler(baseReq, res, next);

    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv; charset=utf-8');
    const contentTypeOrder = (res.setHeader as ReturnType<typeof vi.fn>).mock
      .invocationCallOrder[0];
    const sendOrder = (res.send as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
    expect(contentTypeOrder).toBeLessThan(sendOrder);
    expect(res.send).toHaveBeenCalledWith('name,email\nAda,ada@example.com');
  });

  test('allows custom Content-Type headers to override contentType', async () => {
    const handler = createRouteHandler('GET', '/report', async () => ({
      data: 'report',
      contentType: 'text/csv',
      headers: { 'Content-Type': 'application/vnd.ms-excel' },
    }));

    await handler(baseReq, res, next);

    expect(res.setHeader).toHaveBeenNthCalledWith(1, 'Content-Type', 'text/csv');
    expect(res.setHeader).toHaveBeenNthCalledWith(2, 'Content-Type', 'application/vnd.ms-excel');
  });

  test('handles ModelenceError gracefully and reports to captureError', async () => {
    const error = new ValidationError('fail');
    const handler = createRouteHandler('GET', '/test', async () => {
      throw error;
    });

    await handler(baseReq, res, next);

    expect(mockCaptureError).toHaveBeenCalledWith(error);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.send).toHaveBeenCalledWith('fail');
    expect(transactionEnd).toHaveBeenCalledWith('error');
  });

  test('logs generic errors, captures in telemetry, and sends 500', async () => {
    const error = new Error('boom');
    const handler = createRouteHandler('GET', '/test', async () => {
      throw error;
    });

    await handler(baseReq, res, next);

    expect(mockCaptureError).toHaveBeenCalledWith(error);
    expect(mockLogError).toHaveBeenCalledWith('Error in route handler:', { error, path: '/test' });
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).toHaveBeenCalledWith('Error: boom');
    expect(transactionEnd).toHaveBeenCalledWith('error');
  });

  test('wraps non-Error thrown values before passing to captureError', async () => {
    const handler = createRouteHandler('GET', '/test', async () => {
      throw 'string failure';
    });

    await handler(baseReq, res, next);

    expect(mockCaptureError).toHaveBeenCalledWith(expect.any(Error));
    expect(mockCaptureError.mock.calls[0][0].message).toBe('string failure');
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).toHaveBeenCalledWith('string failure');
    expect(transactionEnd).toHaveBeenCalledWith('error');
  });
});
