import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import type { Request, Response, NextFunction } from 'express';

type RouteDef = {
  path: string;
  handlers: Array<(req: Request, res: Response, next?: NextFunction) => void>;
};
const registeredRoutes: RouteDef[] = [];

const RouterMock = jest.fn(() => ({
  get: (path: string, ...handlers: RouteDef['handlers']) => {
    registeredRoutes.push({ path, handlers });
  },
}));

jest.unstable_mockModule('express', () => ({
  Router: RouterMock,
}));

const mockGetConfig = jest.fn<(key: string) => unknown>();
jest.unstable_mockModule('@/server', () => ({
  getConfig: mockGetConfig,
}));

const mockGetRedirectUri = jest.fn<() => string>();
const mockHandleOAuthUserAuthentication = jest.fn();
const mockValidateOAuthCode = jest.fn<() => string | null>();

jest.unstable_mockModule('./oauth-common', () => ({
  getRedirectUri: mockGetRedirectUri,
  handleOAuthUserAuthentication: mockHandleOAuthUserAuthentication,
  validateOAuthCode: mockValidateOAuthCode,
}));

const fetchMock = jest.fn();

const { default: getRouter } = await import('./google');

describe('auth/providers/google', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    registeredRoutes.length = 0;
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
    mockGetRedirectUri.mockReturnValue(
      'https://app.example.com/api/_internal/auth/google/callback'
    );
    mockValidateOAuthCode.mockReturnValue('auth-code');
    mockGetConfig.mockImplementation((key: string) => {
      const defaults: Record<string, unknown> = {
        '_system.user.auth.google.enabled': true,
        '_system.user.auth.google.clientId': 'client-id',
        '_system.user.auth.google.clientSecret': 'client-secret',
        '_system.site.url': 'https://app.example.com',
      };
      return defaults[key];
    });
    RouterMock.mockClear();
    getRouter();
  });

  // afterAll removed to avoid import issues
  // global.fetch = originalFetch;

  function findRoute(path: string) {
    const route = registeredRoutes.find((r) => r.path === path);
    if (!route) {
      throw new Error(`Route ${path} not registered`);
    }
    return route;
  }

  test('check middleware responds 503 when Google auth disabled', () => {
    const configValues: Record<string, unknown> = {
      '_system.user.auth.google.enabled': false,
      '_system.user.auth.google.clientId': 'client-id',
      '_system.user.auth.google.clientSecret': 'client-secret',
    };
    mockGetConfig.mockImplementation((key: string) => configValues[key]);

    registeredRoutes.length = 0;
    getRouter();
    const route = findRoute('/api/_internal/auth/google');
    const check = route.handlers[0];
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() } as unknown as Response;
    const next = jest.fn();

    check({} as Request, res, next);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({ error: 'Google authentication is not configured' });
    expect(next).not.toHaveBeenCalled();
  });

  test('auth route redirects to Google OAuth when configured', () => {
    const route = findRoute('/api/_internal/auth/google');
    const handler = route.handlers[1];
    const redirectMock = jest.fn();
    const cookieMock = jest.fn();
    const res = { redirect: redirectMock, cookie: cookieMock } as unknown as Response;

    handler({} as Request, res);

    expect(cookieMock).toHaveBeenCalledWith(
      'authStateGoogle',
      expect.any(String),
      expect.any(Object)
    );
    expect(redirectMock).toHaveBeenCalledWith(
      expect.stringContaining('https://accounts.google.com/o/oauth2/v2/auth')
    );
    const redirectUrl = redirectMock.mock.calls[0][0] as string;
    const url = new URL(redirectUrl);
    expect(url.searchParams.get('client_id')).toBe('client-id');
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://app.example.com/api/_internal/auth/google/callback'
    );
    expect(url.searchParams.get('state')).toBeDefined();
  });

  test('callback handler invokes OAuth flow when successful', async () => {
    const route = findRoute('/api/_internal/auth/google/callback');
    const handler = route.handlers[1];

    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'access',
          expires_in: 1000,
          scope: 'profile email',
          token_type: 'Bearer',
          id_token: 'id',
        }),
      } as never)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'google-id',
          email: 'user@example.com',
          verified_email: true,
          name: 'User',
          picture: 'pic',
        }),
      } as never);

    await handler(
      {
        query: { code: 'code', state: 'valid-state' },
        cookies: { authStateGoogle: 'valid-state' },
      } as unknown as Request,
      {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
        clearCookie: jest.fn(),
      } as unknown as Response
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(mockHandleOAuthUserAuthentication).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      {
        id: 'google-id',
        email: 'user@example.com',
        emailVerified: true,
        providerName: 'google',
      }
    );
  });

  test('callback handler returns 400 when authorization code missing', async () => {
    mockValidateOAuthCode.mockReturnValueOnce(null);
    const route = findRoute('/api/_internal/auth/google/callback');
    const handler = route.handlers[1];
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() } as unknown as Response;

    await handler({ query: {}, cookies: {} } as unknown as Request, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Missing authorization code' });
  });

  test('callback handler returns 400 when state invalid', async () => {
    const route = findRoute('/api/_internal/auth/google/callback');
    const handler = route.handlers[1];
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() } as unknown as Response;

    await handler(
      {
        query: { code: 'code', state: 'bad' },
        cookies: { authStateGoogle: 'good' },
      } as unknown as Request,
      res
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid OAuth state - possible CSRF attack' });
  });

  test('callback handler responds 500 when token exchange fails', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    fetchMock.mockResolvedValueOnce({
      ok: false,
      statusText: 'Bad Request',
    } as never);
    const route = findRoute('/api/_internal/auth/google/callback');
    const handler = route.handlers[1];
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      clearCookie: jest.fn(),
    } as unknown as Response;

    await handler(
      {
        query: { code: 'code', state: 's' },
        cookies: { authStateGoogle: 's' },
      } as unknown as Request,
      res
    );

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Authentication failed' });
    consoleError.mockRestore();
  });
});
