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

const { default: getRouter } = await import('./github');

describe('auth/providers/github', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    registeredRoutes.length = 0;
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
    mockGetRedirectUri.mockReturnValue(
      'https://app.example.com/api/_internal/auth/github/callback'
    );
    mockValidateOAuthCode.mockReturnValue('auth-code');
    mockGetConfig.mockImplementation((key: string) => {
      const defaults: Record<string, unknown> = {
        '_system.user.auth.github.enabled': true,
        '_system.user.auth.github.clientId': 'client-id',
        '_system.user.auth.github.clientSecret': 'client-secret',
        '_system.user.auth.github.scopes': 'read:user,user:email',
      };
      return defaults[key];
    });
    getRouter();
  });

  const findRoute = (path: string) => {
    const route = registeredRoutes.find((r) => r.path === path);
    if (!route) {
      throw new Error(`Route for ${path} not found`);
    }
    return route;
  };

  test('check middleware responds 503 when GitHub auth disabled', () => {
    mockGetConfig.mockImplementation(
      (key: string) =>
        ({
          '_system.user.auth.github.enabled': false,
          '_system.user.auth.github.clientId': 'client-id',
          '_system.user.auth.github.clientSecret': 'client-secret',
        })[key]
    );

    registeredRoutes.length = 0;
    getRouter();
    const route = findRoute('/api/_internal/auth/github');
    const check = route.handlers[0];
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() } as unknown as Response;
    const next = jest.fn();

    check({} as Request, res, next);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({ error: 'GitHub authentication is not configured' });
    expect(next).not.toHaveBeenCalled();
  });

  test('auth route redirects with custom scopes', () => {
    const route = findRoute('/api/_internal/auth/github');
    const handler = route.handlers[1];
    const redirect = jest.fn();
    const cookie = jest.fn();

    handler({} as Request, { redirect, cookie } as unknown as Response);

    expect(cookie).toHaveBeenCalledWith('authStateGithub', expect.any(String), expect.any(Object));
    const redirectUrl = redirect.mock.calls[0][0] as string;
    const url = new URL(redirectUrl);
    expect(url.origin).toBe('https://github.com');
    expect(url.searchParams.get('client_id')).toBe('client-id');
    expect(url.searchParams.get('scope')).toBe('read:user user:email');
    expect(url.searchParams.get('state')).toBeDefined();
  });

  test('callback handler forwards user when email available', async () => {
    const route = findRoute('/api/_internal/auth/github/callback');
    const handler = route.handlers[1];

    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'token', token_type: 'Bearer', scope: 'read:user' }),
      } as never)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 123,
          login: 'demo',
          email: 'user@example.com',
          avatar_url: 'pic',
        }),
      } as never);

    await handler(
      {
        query: { code: 'code', state: 's' },
        cookies: { authStateGithub: 's' },
      } as unknown as Request,
      {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
        clearCookie: jest.fn(),
      } as unknown as Response
    );

    expect(mockHandleOAuthUserAuthentication).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      {
        id: '123',
        email: 'user@example.com',
        emailVerified: true,
        providerName: 'github',
      }
    );
  });

  test('callback handler rejects when email missing', async () => {
    const route = findRoute('/api/_internal/auth/github/callback');
    const handler = route.handlers[1];
    fetchMock
      // token exchange
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'token', token_type: 'Bearer', scope: 'read:user' }),
      } as never)
      // /user
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 123,
          login: 'demo',
          email: null,
          avatar_url: 'pic',
        }),
      } as never)
      // /user/emails
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      } as never);

    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      clearCookie: jest.fn(),
    } as unknown as Response;

    await handler(
      {
        query: { code: 'code', state: 's' },
        cookies: { authStateGithub: 's' },
      } as unknown as Request,
      res
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error:
        'Unable to retrieve a primary verified email from GitHub. Please ensure your GitHub account has a verified email set as primary.',
    });
    expect(mockHandleOAuthUserAuthentication).not.toHaveBeenCalled();
  });

  test('callback handler returns 400 when authorization code missing', async () => {
    mockValidateOAuthCode.mockReturnValueOnce(null);
    const route = findRoute('/api/_internal/auth/github/callback');
    const handler = route.handlers[1];
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() } as unknown as Response;

    await handler({ query: {}, cookies: {} } as unknown as Request, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Missing authorization code' });
  });

  test('callback handler returns 400 when state invalid', async () => {
    const route = findRoute('/api/_internal/auth/github/callback');
    const handler = route.handlers[1];
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() } as unknown as Response;

    await handler(
      {
        query: { code: 'code', state: 'a' },
        cookies: { authStateGithub: 'b' },
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
      statusText: 'Bad request',
    } as never);

    const route = findRoute('/api/_internal/auth/github/callback');
    const handler = route.handlers[1];
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      clearCookie: jest.fn(),
    } as unknown as Response;

    await handler(
      {
        query: { code: 'code', state: 's' },
        cookies: { authStateGithub: 's' },
      } as unknown as Request,
      res
    );

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Authentication failed' });
    consoleError.mockRestore();
  });
});
