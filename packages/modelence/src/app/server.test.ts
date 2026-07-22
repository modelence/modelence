import { describe, expect, test, beforeEach, afterEach, vi } from 'vitest';
import type { Mock, MockedFunction } from 'vitest';
import { ObjectId } from 'mongodb';
import type { Request, Response, RequestHandler } from 'express';
import type { AppServer, ExpressMiddleware } from '../types';
import { ServerChannel } from '@/websocket/serverChannel';
import { Module } from './module';
import type { RouteHandler } from '@/routes/types';

// Type definitions for test mocks
type MockExpressApp = {
  set: Mock;
  use: Mock;
  post: Mock;
  get: Mock;
  put: Mock;
  patch: Mock;
  delete: Mock;
  all: Mock;
};

type MockHttpServer = {
  listen: Mock;
};

type MockAppServer = AppServer & {
  init: MockedFunction<AppServer['init']>;
  handler: MockedFunction<AppServer['handler']>;
  middlewares?: MockedFunction<NonNullable<AppServer['middlewares']>>;
};

type ExpressRouteHandler = RequestHandler;

const createMockServer = (): MockAppServer => ({
  init: vi.fn<AppServer['init']>(async () => {}),
  handler: vi.fn<AppServer['handler']>(),
});

const mockAuthenticate = vi.fn();
const mockGetUnauthenticatedRoles = vi.fn();
const mockGetMongodbUri = vi.fn();
const mockGetClient = vi.fn();
const mockConnect = vi.fn();
const mockRequireAccess = vi.fn();
const mockHasAccess = vi.fn();
const mockHasPermission = vi.fn();
const mockGetDefaultAuthenticatedRoles = vi.fn();
const mockInitRoles = vi.fn();
const mockRunMethod =
  vi.fn<
    (methodName: string, args: unknown, context: unknown) => Promise<Record<string, unknown>>
  >();
const mockGetResponseTypeMap = vi.fn<(result: unknown) => Record<string, string>>();
const mockCreateRouteHandler =
  vi.fn<(method: string, path: string, handler: unknown) => RequestHandler>();
const mockGoogleAuthRouter = vi.fn();
const mockGithubAuthRouter = vi.fn();
const mockLogInfo = vi.fn();
const mockGetSecurityConfig = vi.fn();
const mockGetWebsocketConfig = vi.fn();
const mockExpressJson = vi.fn();
const mockExpressUrlencoded = vi.fn();
const mockExpressRaw = vi.fn();
const mockCookieParser = vi.fn();
const mockHttpCreateServer = vi.fn();

vi.doMock('../auth', () => ({
  authenticate: mockAuthenticate,
}));

vi.doMock('../auth/role', () => ({
  getUnauthenticatedRoles: mockGetUnauthenticatedRoles,
  requireAccess: mockRequireAccess,
  hasAccess: mockHasAccess,
  hasPermission: mockHasPermission,
  getDefaultAuthenticatedRoles: mockGetDefaultAuthenticatedRoles,
  initRoles: mockInitRoles,
}));

vi.doMock('../db/client', () => ({
  getMongodbUri: mockGetMongodbUri,
  getClient: mockGetClient,
  connect: mockConnect,
}));

vi.doMock('@/methods', () => ({
  runMethod: mockRunMethod,
}));

vi.doMock('@/methods/serialize', () => ({
  getResponseTypeMap: mockGetResponseTypeMap,
  sanitizeResult: (result: unknown) => result,
}));

vi.doMock('@/routes/handler', () => ({
  createRouteHandler: mockCreateRouteHandler,
}));

vi.doMock('@/auth/providers/google', () => ({
  default: mockGoogleAuthRouter,
}));

vi.doMock('@/auth/providers/github', () => ({
  default: mockGithubAuthRouter,
}));

vi.doMock('@/telemetry', () => ({
  logInfo: mockLogInfo,
  logError: mockLogInfo,
}));

vi.doMock('./securityConfig', () => ({
  getSecurityConfig: mockGetSecurityConfig,
}));

vi.doMock('./websocketConfig', () => ({
  getWebsocketConfig: mockGetWebsocketConfig,
}));

let mockExpressApp: MockExpressApp;
const createExpressAppMock = (): MockExpressApp => ({
  set: vi.fn(),
  use: vi.fn(),
  post: vi.fn(),
  get: vi.fn(),
  put: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
  all: vi.fn(),
});

type MiddlewareFn = (req: unknown, res: unknown, next: () => void) => void;

function findSecurityMiddleware(app: MockExpressApp): MiddlewareFn | undefined {
  for (const call of app.use.mock.calls) {
    const fn = call[0];
    if (typeof fn !== 'function') continue;
    const mockRes = { setHeader: vi.fn() };
    (fn as MiddlewareFn)({}, mockRes, () => {});
    const setsCSP = mockRes.setHeader.mock.calls.some(
      (args: unknown[]) => args[0] === 'Content-Security-Policy'
    );
    if (setsCSP) return fn as MiddlewareFn;
  }
  return undefined;
}

const getRegisteredMethodHandler = (app: MockExpressApp) => {
  const call = app.post.mock.calls.find(([path]) =>
    String(path).includes('/api/_internal/method/')
  );
  if (!call) {
    throw new Error('Method handler not registered');
  }
  return call[1] as (req: Request, res: Response) => Promise<unknown>;
};

const getRegisteredSetLinkCookieHandler = (app: MockExpressApp) => {
  const call = app.post.mock.calls.find(([path]) =>
    String(path).includes('/api/_internal/auth/set-link-cookie')
  );
  if (!call) {
    throw new Error('Set-link-cookie handler not registered');
  }
  return call[1] as (req: Request, res: Response) => Promise<unknown>;
};

vi.doMock('express', () => {
  const express = vi.fn(() => {
    // Return the app set in beforeEach
    return mockExpressApp || createExpressAppMock();
  }) as Mock & { json: Mock; urlencoded: Mock; raw: Mock };
  express.json = mockExpressJson;
  express.urlencoded = mockExpressUrlencoded;
  express.raw = mockExpressRaw;
  return { default: express };
});

vi.doMock('cookie-parser', () => ({
  default: mockCookieParser,
}));

vi.doMock('http', () => ({
  default: {
    createServer: mockHttpCreateServer,
  },
}));

const { getCallContext, startServer } = await import('./server');

function createRequest(overrides: Partial<Request> & { headers?: Record<string, string> } = {}) {
  const headers = Object.entries(overrides.headers ?? {}).reduce(
    (acc, [key, value]) => ({ ...acc, [key.toLowerCase()]: value }),
    {} as Record<string, string>
  );

  return {
    cookies: {},
    body: {},
    params: {},
    query: {},
    ip: undefined,
    protocol: 'http',
    get: (name: string) => headers[name.toLowerCase()],
    ...overrides,
    headers,
  } as Request;
}

function createResponse(): Response {
  const res = {
    json: vi.fn(),
    send: vi.fn(),
    status: vi.fn(),
    sendFile: vi.fn(),
    cookie: vi.fn(),
    setHeader: vi.fn(),
  } as unknown as Response;
  (res.status as Mock).mockReturnValue(res);
  return res;
}

describe('app/server getCallContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue({ session: null, user: null, roles: [] } as never);
    mockGetUnauthenticatedRoles.mockReturnValue(['guest']);
    mockGetMongodbUri.mockReturnValue(undefined);
  });

  test('populates context from database when available', async () => {
    const req = createRequest({
      cookies: { authToken: 'cookie-token' },
      body: {
        clientInfo: {
          screenWidth: 100,
          screenHeight: 100,
          windowWidth: 100,
          windowHeight: 100,
          pixelRatio: 1,
          orientation: 'portrait',
        },
      },
      headers: {
        host: 'localhost:3000',
        'user-agent': 'jest',
        referrer: 'http://example.com',
        'accept-language': 'en-US',
      },
      protocol: 'https',
    });
    mockGetMongodbUri.mockReturnValue('mongodb://localhost');
    mockAuthenticate.mockResolvedValue({
      session: { authToken: 'session-token', expiresAt: new Date(), userId: new ObjectId() },
      user: {
        id: '1',
        handle: 'testuser',
        roles: ['user'],
        hasRole: (role: string) => role === 'user',
        requireRole: (role: string) => {
          if (role !== 'user') throw new Error(`Access denied - role '${role}' required`);
        },
      },
      roles: ['user'],
    } as never);

    const ctx = await getCallContext(req, {} as Response);

    expect(mockAuthenticate).toHaveBeenCalledWith('cookie-token');
    expect(ctx.session?.authToken).toBe('session-token');
    expect(ctx.connectionInfo).toMatchObject({
      baseUrl: 'https://localhost:3000',
      userAgent: 'jest',
      referrer: 'http://example.com',
    });
    expect(ctx.clientInfo.screenWidth).toBe(100);
  });

  test('falls back to unauthenticated context when database missing', async () => {
    const req = createRequest({
      body: {
        authToken: 'body-token',
      },
      headers: {
        'x-forwarded-for': '10.0.0.1, 2.2.2.2',
        host: 'localhost',
      },
      protocol: 'http',
    });
    mockGetMongodbUri.mockReturnValue('');

    const ctx = await getCallContext(req, {} as Response);

    expect(ctx.session).toBeNull();
    expect(ctx.roles).toEqual(['guest']);
    expect(ctx.connectionInfo.ip).toBe('10.0.0.1');
  });

  test('normalizes direct IP addresses without proxy headers', async () => {
    const req = createRequest({
      ip: '::ffff:192.168.0.10',
      headers: { host: 'localhost' },
    });
    mockGetMongodbUri.mockReturnValue('');

    const ctx = await getCallContext(req, {} as Response);

    expect(ctx.connectionInfo.ip).toBe('192.168.0.10');
  });

  test('uses authToken from request body when not in cookies', async () => {
    const req = createRequest({
      body: { authToken: 'body-token' },
      headers: { host: 'localhost' },
    });
    mockGetMongodbUri.mockReturnValue('mongodb://localhost');
    mockAuthenticate.mockResolvedValue({
      session: { authToken: 'body-token', expiresAt: new Date(), userId: new ObjectId() },
      user: { id: '1', handle: 'testuser', roles: ['user'] },
      roles: ['user'],
    } as never);

    const ctx = await getCallContext(req, {} as Response);

    expect(mockAuthenticate).toHaveBeenCalledWith('body-token');
    expect(ctx.session?.authToken).toBe('body-token');
  });

  test('handles null authToken', async () => {
    const req = createRequest({
      headers: { host: 'localhost' },
    });
    mockGetMongodbUri.mockReturnValue('');

    const ctx = await getCallContext(req, {} as Response);

    expect(ctx.session).toBeNull();
    expect(ctx.roles).toEqual(['guest']);
  });

  test('provides default clientInfo when not provided', async () => {
    const req = createRequest({
      headers: { host: 'localhost' },
    });
    mockGetMongodbUri.mockReturnValue('');

    const ctx = await getCallContext(req, {} as Response);

    expect(ctx.clientInfo).toEqual({
      screenWidth: 0,
      screenHeight: 0,
      windowWidth: 0,
      windowHeight: 0,
      pixelRatio: 1,
      orientation: null,
    });
  });

  test('parses connection info from request headers', async () => {
    const req = createRequest({
      headers: {
        host: 'example.com',
        'user-agent': 'Mozilla/5.0',
        'accept-language': 'en-US,en;q=0.9',
        referrer: 'https://google.com',
      },
      protocol: 'https',
    });
    mockGetMongodbUri.mockReturnValue('');

    const ctx = await getCallContext(req, {} as Response);

    expect(ctx.connectionInfo).toEqual({
      ip: undefined,
      userAgent: 'Mozilla/5.0',
      acceptLanguage: 'en-US,en;q=0.9',
      referrer: 'https://google.com',
      baseUrl: 'https://example.com',
    });
  });

  test('handles X-Forwarded-For with multiple IPs', async () => {
    const req = createRequest({
      headers: {
        'x-forwarded-for': '1.2.3.4, 5.6.7.8, 9.10.11.12',
        host: 'localhost',
      },
    });
    mockGetMongodbUri.mockReturnValue('');

    const ctx = await getCallContext(req, {} as Response);

    expect(ctx.connectionInfo.ip).toBe('1.2.3.4');
  });

  test('handles X-Forwarded-For as array', async () => {
    const req = createRequest({
      headers: { host: 'localhost' },
    });
    req.headers['x-forwarded-for'] = ['1.2.3.4', '5.6.7.8'];
    mockGetMongodbUri.mockReturnValue('');

    const ctx = await getCallContext(req, {} as Response);

    expect(ctx.connectionInfo.ip).toBe('1.2.3.4');
  });

  test('uses socket remoteAddress when ip is not available', async () => {
    const req = createRequest({
      headers: { host: 'localhost' },
    });
    req.socket = { remoteAddress: '10.0.0.5' } as unknown as Request['socket'];
    mockGetMongodbUri.mockReturnValue('');

    const ctx = await getCallContext(req, {} as Response);

    expect(ctx.connectionInfo.ip).toBe('10.0.0.5');
  });

  test('derives baseUrl from X-Forwarded-Host / X-Forwarded-Proto behind a proxy', async () => {
    const req = createRequest({
      headers: {
        // The internal container values seen behind the reverse proxy.
        host: '10.1.118.6:3000',
        'x-forwarded-host': 'tenant-sandbox-3cus3.sandbox.modelence.app',
        'x-forwarded-proto': 'https',
      },
      protocol: 'http',
    });
    mockGetMongodbUri.mockReturnValue('');

    const ctx = await getCallContext(req, {} as Response);

    expect(ctx.connectionInfo.baseUrl).toBe('https://tenant-sandbox-3cus3.sandbox.modelence.app');
  });

  test('uses the first value of comma-separated forwarded headers', async () => {
    const req = createRequest({
      headers: {
        host: '10.1.118.6:3000',
        'x-forwarded-host': 'public.example.com, internal.example.com',
        'x-forwarded-proto': 'https, http',
      },
      protocol: 'http',
    });
    mockGetMongodbUri.mockReturnValue('');

    const ctx = await getCallContext(req, {} as Response);

    expect(ctx.connectionInfo.baseUrl).toBe('https://public.example.com');
  });

  test('falls back to direct host and protocol without forwarded headers', async () => {
    const req = createRequest({
      headers: { host: 'localhost:3000' },
      protocol: 'http',
    });
    mockGetMongodbUri.mockReturnValue('');

    const ctx = await getCallContext(req, {} as Response);

    expect(ctx.connectionInfo.baseUrl).toBe('http://localhost:3000');
  });
});

describe('app/server startServer', () => {
  let mockApp: MockExpressApp;
  let mockHttpServer: MockHttpServer;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    vi.clearAllMocks();
    originalEnv = { ...process.env };

    mockApp = {
      set: vi.fn(),
      use: vi.fn(),
      post: vi.fn(),
      get: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
      all: vi.fn(),
    };

    // Set the app that will be returned by express()
    mockExpressApp = mockApp;

    mockHttpServer = {
      listen: vi.fn(((_port: unknown, callback?: () => void) => {
        if (callback) callback();
        return mockHttpServer;
      }) as Mock),
    };

    mockExpressJson.mockReturnValue('json-middleware');
    mockExpressUrlencoded.mockReturnValue('urlencoded-middleware');
    mockCookieParser.mockReturnValue('cookie-parser-middleware');
    mockGoogleAuthRouter.mockReturnValue('google-router');
    mockGithubAuthRouter.mockReturnValue('github-router');
    mockHttpCreateServer.mockReturnValue(mockHttpServer);
    mockGetSecurityConfig.mockReturnValue({});
    mockGetWebsocketConfig.mockReturnValue(null);
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test('sets default security headers (self-only framing)', async () => {
    const mockServer = createMockServer();

    await startServer(mockServer, {
      combinedModules: [],
      channels: [],
    });

    const middleware = findSecurityMiddleware(mockApp);
    expect(middleware).toBeDefined();

    const mockRes = { setHeader: vi.fn() };
    middleware!({}, mockRes, () => {});

    expect(mockRes.setHeader).toHaveBeenCalledWith(
      'Content-Security-Policy',
      "frame-ancestors 'self'"
    );
    expect(mockRes.setHeader).toHaveBeenCalledWith('X-Frame-Options', 'SAMEORIGIN');
  });

  test('sets custom frame-ancestors and omits X-Frame-Options', async () => {
    mockGetSecurityConfig.mockReturnValue({
      frameAncestors: ['https://modelence.com', 'https://example.com'],
    });

    const mockServer = createMockServer();

    await startServer(mockServer, {
      combinedModules: [],
      channels: [],
    });

    const middleware = findSecurityMiddleware(mockApp);
    expect(middleware).toBeDefined();

    const mockRes = { setHeader: vi.fn() };
    middleware!({}, mockRes, () => {});

    expect(mockRes.setHeader).toHaveBeenCalledWith(
      'Content-Security-Policy',
      "frame-ancestors 'self' https://modelence.com https://example.com"
    );
    expect(mockRes.setHeader).not.toHaveBeenCalledWith('X-Frame-Options', expect.anything());
  });

  test('initializes express app with middleware', async () => {
    const viteMiddleware = vi.fn() as unknown as ExpressMiddleware;
    const mockServer = {
      ...createMockServer(),
      middlewares: vi.fn(() => [viteMiddleware]),
    };

    await startServer(mockServer, {
      combinedModules: [],
      channels: [],
    });

    expect(mockApp.use).toHaveBeenCalledWith('json-middleware');
    expect(mockApp.use).toHaveBeenCalledWith('urlencoded-middleware');
    expect(mockApp.use).toHaveBeenCalledWith('cookie-parser-middleware');
    expect(mockExpressJson).toHaveBeenCalledWith({ limit: '16mb' });
    expect(mockExpressUrlencoded).toHaveBeenCalledWith({ extended: true, limit: '16mb' });
  });

  test('registers auth providers', async () => {
    const mockServer = createMockServer();

    await startServer(mockServer, {
      combinedModules: [],
      channels: [],
    });

    expect(mockApp.use).toHaveBeenCalledWith('google-router');
    expect(mockApp.use).toHaveBeenCalledWith('github-router');
  });

  test('registers internal method endpoint', async () => {
    const mockServer = createMockServer();

    await startServer(mockServer, {
      combinedModules: [],
      channels: [],
    });

    expect(mockApp.post).toHaveBeenCalledWith(
      '/api/_internal/method/:methodName(*)',
      expect.any(Function)
    );
  });

  test('calls server init before adding middlewares', async () => {
    const callOrder: string[] = [];
    const testMiddleware = vi.fn() as unknown as ExpressMiddleware;
    const mockServer = {
      ...createMockServer(),
      middlewares: vi.fn(() => {
        callOrder.push('middlewares');
        return [testMiddleware];
      }),
    };
    mockServer.init.mockImplementation(async () => {
      callOrder.push('init');
    });

    await startServer(mockServer, {
      combinedModules: [],
      channels: [],
    });

    expect(callOrder).toEqual(['init', 'middlewares']);
  });

  test('registers catch-all route handler', async () => {
    const mockHandler = vi.fn<AppServer['handler']>();
    const mockServer = createMockServer();
    mockServer.handler = mockHandler;

    await startServer(mockServer, {
      combinedModules: [],
      channels: [],
    });

    expect(mockApp.all).toHaveBeenCalledWith('*', expect.any(Function));
  });

  test('creates HTTP server and starts listening', async () => {
    const mockServer = createMockServer();

    await startServer(mockServer, {
      combinedModules: [],
      channels: [],
    });

    expect(mockHttpCreateServer).toHaveBeenCalledWith(mockApp);
    expect(mockHttpServer.listen).toHaveBeenCalled();
  });

  test('uses MODELENCE_PORT environment variable', async () => {
    process.env.MODELENCE_PORT = '4000';
    const mockServer = createMockServer();

    await startServer(mockServer, {
      combinedModules: [],
      channels: [],
    });

    expect(mockHttpServer.listen).toHaveBeenCalledWith('4000', expect.any(Function));
  });

  test('uses PORT environment variable as fallback', async () => {
    process.env.PORT = '5000';
    const mockServer = createMockServer();

    await startServer(mockServer, {
      combinedModules: [],
      channels: [],
    });

    expect(mockHttpServer.listen).toHaveBeenCalledWith('5000', expect.any(Function));
  });

  test('defaults to port 3000', async () => {
    delete process.env.MODELENCE_PORT;
    delete process.env.PORT;
    const mockServer = createMockServer();

    await startServer(mockServer, {
      combinedModules: [],
      channels: [],
    });

    expect(mockHttpServer.listen).toHaveBeenCalledWith(3000, expect.any(Function));
  });

  test('initializes websocket provider when configured', async () => {
    const mockWebsocketProvider = {
      init: vi.fn(),
      broadcast: vi.fn(),
    };
    mockGetWebsocketConfig.mockReturnValue({ provider: mockWebsocketProvider });

    const mockServer = createMockServer();
    const channels = [new ServerChannel('test-channel')];

    await startServer(mockServer, {
      combinedModules: [],
      channels,
    });

    expect(mockWebsocketProvider.init).toHaveBeenCalledWith({
      httpServer: mockHttpServer,
      channels,
    });
  });

  test('skips websocket initialization when not configured', async () => {
    mockGetWebsocketConfig.mockReturnValue(null);

    const mockServer = createMockServer();

    await startServer(mockServer, {
      combinedModules: [],
      channels: [],
    });

    // Should complete without error
    expect(mockHttpServer.listen).toHaveBeenCalled();
  });

  test('registers module routes', async () => {
    const mockRouteHandler = vi.fn() as unknown as ExpressRouteHandler;
    mockCreateRouteHandler.mockReturnValue(mockRouteHandler);

    const mockModule = new Module('testModule', {
      routes: [
        {
          path: '/api/test',
          handlers: {
            get: vi.fn<RouteHandler>(() => ({ status: 200, data: {} })),
            post: vi.fn<RouteHandler>(() => ({ status: 200, data: {} })),
          },
        },
      ],
    });

    const mockServer = createMockServer();

    await startServer(mockServer, {
      combinedModules: [mockModule],
      channels: [],
    });

    expect(mockCreateRouteHandler).toHaveBeenCalledWith('get', '/api/test', expect.any(Function));
    expect(mockCreateRouteHandler).toHaveBeenCalledWith('post', '/api/test', expect.any(Function));
    // Routes now include body parser middleware
    expect(mockApp.get).toHaveBeenCalledWith(
      '/api/test',
      'json-middleware',
      'urlencoded-middleware',
      mockRouteHandler
    );
    expect(mockApp.post).toHaveBeenCalledWith(
      '/api/test',
      'json-middleware',
      'urlencoded-middleware',
      mockRouteHandler
    );
  });

  test('handles multiple modules with routes', async () => {
    mockCreateRouteHandler.mockReturnValue(vi.fn() as unknown as ExpressRouteHandler);

    const modules = [
      new Module('module1', {
        routes: [
          {
            path: '/api/foo',
            handlers: { get: vi.fn<RouteHandler>(() => ({ status: 200, data: {} })) },
          },
        ],
      }),
      new Module('module2', {
        routes: [
          {
            path: '/api/bar',
            handlers: { post: vi.fn<RouteHandler>(() => ({ status: 200, data: {} })) },
          },
        ],
      }),
    ];

    const mockServer = createMockServer();

    await startServer(mockServer, {
      combinedModules: modules,
      channels: [],
    });

    // Routes now include body parser middleware
    expect(mockApp.get).toHaveBeenCalledWith(
      '/api/foo',
      'json-middleware',
      'urlencoded-middleware',
      expect.any(Function)
    );
    expect(mockApp.post).toHaveBeenCalledWith(
      '/api/bar',
      'json-middleware',
      'urlencoded-middleware',
      expect.any(Function)
    );
  });

  test('logs application startup', async () => {
    const mockServer = createMockServer();

    await startServer(mockServer, {
      combinedModules: [],
      channels: [],
    });

    expect(mockLogInfo).toHaveBeenCalledWith('Application started', { source: 'app' });
  });
});

describe('app/server method endpoint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSecurityConfig.mockReturnValue({});
    mockGetWebsocketConfig.mockReturnValue(null);

    mockExpressJson.mockReturnValue('json-middleware');
    mockExpressUrlencoded.mockReturnValue('urlencoded-middleware');
    mockCookieParser.mockReturnValue('cookie-parser-middleware');
    mockGoogleAuthRouter.mockReturnValue('google-router');
    mockGithubAuthRouter.mockReturnValue('github-router');
    mockHttpCreateServer.mockReturnValue({
      listen: vi.fn((_port: unknown, callback?: () => void) => {
        if (callback) callback();
      }),
    });
  });

  test('handles successful method call', async () => {
    const mockApp = createExpressAppMock();
    mockExpressApp = mockApp;

    mockRunMethod.mockResolvedValue({ result: 'success' });
    mockGetResponseTypeMap.mockReturnValue({ result: 'string' });

    const mockServer = createMockServer();

    await startServer(mockServer, {
      combinedModules: [],
      channels: [],
    });

    // Get the method handler that was registered
    const methodHandler = getRegisteredMethodHandler(mockApp);

    expect(methodHandler).toBeDefined();

    const req = createRequest({
      params: { methodName: 'testMethod' },
      body: { args: { foo: 'bar' } },
      headers: { host: 'localhost' },
    });
    const res = createResponse();

    mockGetMongodbUri.mockReturnValue('');

    await methodHandler(req, res);

    expect(mockRunMethod).toHaveBeenCalledWith('testMethod', { foo: 'bar' }, expect.any(Object));
    expect(res.json).toHaveBeenCalledWith({
      data: { result: 'success' },
      typeMap: { result: 'string' },
    });
  });

  test('handles ModelenceError with custom status', async () => {
    const mockApp = createExpressAppMock();
    mockExpressApp = mockApp;

    const { AuthError } = await import('../error');
    mockRunMethod.mockRejectedValue(new AuthError('Unauthorized'));

    const mockServer = createMockServer();

    await startServer(mockServer, {
      combinedModules: [],
      channels: [],
    });

    const methodHandler = getRegisteredMethodHandler(mockApp);

    const req = createRequest({
      params: { methodName: 'testMethod' },
      body: { args: {} },
      headers: { host: 'localhost' },
    });
    const res = createResponse();

    mockGetMongodbUri.mockReturnValue('');

    await methodHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.send).toHaveBeenCalledWith('Unauthorized');
    expect(res.setHeader).not.toHaveBeenCalledWith('X-Modelence-Error-Code', expect.anything());
  });

  test('sets X-Modelence-Error-Code header when error carries a code', async () => {
    const mockApp = createExpressAppMock();
    mockExpressApp = mockApp;

    const { AuthError } = await import('../error');
    mockRunMethod.mockRejectedValue(new AuthError('Unverified', 'EMAIL_NOT_VERIFIED'));

    const mockServer = createMockServer();

    await startServer(mockServer, {
      combinedModules: [],
      channels: [],
    });

    const methodHandler = getRegisteredMethodHandler(mockApp);

    const req = createRequest({
      params: { methodName: 'testMethod' },
      body: { args: {} },
      headers: { host: 'localhost' },
    });
    const res = createResponse();

    mockGetMongodbUri.mockReturnValue('');

    await methodHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.send).toHaveBeenCalledWith('Unverified');
    expect(res.setHeader).toHaveBeenCalledWith('X-Modelence-Error-Code', 'EMAIL_NOT_VERIFIED');
  });

  test('handles ZodError with validation messages', async () => {
    const mockApp = createExpressAppMock();
    mockExpressApp = mockApp;

    const zodError: Error & {
      constructor: { name: string };
      errors: unknown[];
      flatten: () => { fieldErrors: Record<string, string[]>; formErrors: string[] };
    } = new Error('Validation failed') as Error & {
      constructor: { name: string };
      errors: unknown[];
      flatten: () => { fieldErrors: Record<string, string[]>; formErrors: string[] };
    };
    zodError.constructor = { name: 'ZodError' };
    zodError.errors = [];
    zodError.flatten = () => ({
      fieldErrors: { email: ['Invalid email'], age: ['Must be positive'] },
      formErrors: ['Form invalid'],
    });

    mockRunMethod.mockRejectedValue(zodError);

    const mockServer = createMockServer();

    await startServer(mockServer, {
      combinedModules: [],
      channels: [],
    });

    const methodHandler = getRegisteredMethodHandler(mockApp);

    const req = createRequest({
      params: { methodName: 'testMethod' },
      body: { args: {} },
      headers: { host: 'localhost' },
    });
    const res = createResponse();

    mockGetMongodbUri.mockReturnValue('');

    await methodHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.send).toHaveBeenCalledWith(
      'email: Invalid email; age: Must be positive; Form invalid'
    );
  });

  test('handles generic error with 500 status', async () => {
    const mockApp = createExpressAppMock();
    mockExpressApp = mockApp;

    mockRunMethod.mockRejectedValue(new Error('Something went wrong'));

    const mockServer = createMockServer();

    await startServer(mockServer, {
      combinedModules: [],
      channels: [],
    });

    const methodHandler = getRegisteredMethodHandler(mockApp);

    const req = createRequest({
      params: { methodName: 'testMethod' },
      body: { args: {} },
      headers: { host: 'localhost' },
    });
    const res = createResponse();

    mockGetMongodbUri.mockReturnValue('');

    await methodHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).toHaveBeenCalledWith('Something went wrong');
  });

  test('handles non-Error thrown values', async () => {
    const mockApp = createExpressAppMock();
    mockExpressApp = mockApp;

    mockRunMethod.mockRejectedValue('String error');

    const mockServer = createMockServer();

    await startServer(mockServer, {
      combinedModules: [],
      channels: [],
    });

    const methodHandler = getRegisteredMethodHandler(mockApp);

    const req = createRequest({
      params: { methodName: 'testMethod' },
      body: { args: {} },
      headers: { host: 'localhost' },
    });
    const res = createResponse();

    mockGetMongodbUri.mockReturnValue('');

    await methodHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).toHaveBeenCalledWith('String error');
  });
});

describe('app/server set-link-cookie endpoint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSecurityConfig.mockReturnValue({});
    mockGetWebsocketConfig.mockReturnValue(null);

    mockExpressJson.mockReturnValue('json-middleware');
    mockExpressUrlencoded.mockReturnValue('urlencoded-middleware');
    mockCookieParser.mockReturnValue('cookie-parser-middleware');
    mockGoogleAuthRouter.mockReturnValue('google-router');
    mockGithubAuthRouter.mockReturnValue('github-router');
    mockHttpCreateServer.mockReturnValue({
      listen: vi.fn((_port: unknown, callback?: () => void) => {
        if (callback) callback();
      }),
    });
  });

  test('returns 401 when user is not authenticated', async () => {
    const mockApp = createExpressAppMock();
    mockExpressApp = mockApp;

    const mockServer = createMockServer();

    await startServer(mockServer, {
      combinedModules: [],
      channels: [],
    });

    const handler = getRegisteredSetLinkCookieHandler(mockApp);

    const req = createRequest({
      body: { authToken: 'some-token' },
      headers: { host: 'localhost' },
    });
    const res = createResponse();

    mockGetMongodbUri.mockReturnValue('mongodb://localhost');
    mockAuthenticate.mockResolvedValue({
      session: { authToken: 'some-token', userId: null },
      user: null,
      roles: [],
    } as never);

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Not authenticated' });
    expect(res.cookie).not.toHaveBeenCalled();
  });

  test('sets httpOnly oauthLinkToken cookie when authenticated', async () => {
    const mockApp = createExpressAppMock();
    mockExpressApp = mockApp;

    const mockServer = createMockServer();

    await startServer(mockServer, {
      combinedModules: [],
      channels: [],
    });

    const handler = getRegisteredSetLinkCookieHandler(mockApp);

    const userId = new ObjectId();
    const req = createRequest({
      body: { authToken: 'session-token' },
      headers: { host: 'localhost' },
    });
    const res = createResponse();

    mockGetMongodbUri.mockReturnValue('mongodb://localhost');
    mockAuthenticate.mockResolvedValue({
      session: { authToken: 'session-token', expiresAt: new Date(), userId },
      user: { id: userId.toString(), handle: 'testuser', roles: [] },
      roles: ['user'],
    } as never);

    await handler(req, res);

    expect(res.cookie).toHaveBeenCalledWith('oauthLinkToken', 'session-token', {
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      path: '/api/_internal/auth/',
      maxAge: 10 * 60 * 1000,
    });
    expect(res.json).toHaveBeenCalledWith({ ok: true });
  });
});
