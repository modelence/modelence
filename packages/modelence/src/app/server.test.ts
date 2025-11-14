import { describe, expect, jest, test, beforeEach, afterEach } from '@jest/globals';
import { ObjectId } from 'mongodb';
import type { Request, Response } from 'express';
import type { AppServer } from '../types';
import { ServerChannel } from '@/websocket/serverChannel';
import { Module } from './module';

// Type definitions for test mocks
type MockExpressApp = {
  use: jest.Mock;
  post: jest.Mock;
  get: jest.Mock;
  put: jest.Mock;
  patch: jest.Mock;
  delete: jest.Mock;
  all: jest.Mock;
};

type MockHttpServer = {
  listen: jest.Mock;
};

type MockAppServer = AppServer & {
  init: jest.Mock<Promise<void>, []>;
  handler: jest.Mock<void, Parameters<AppServer['handler']>>;
  middlewares?: jest.Mock<ReturnType<NonNullable<AppServer['middlewares']>>>;
};

const createMockServer = (): MockAppServer => ({
  init: jest.fn(async () => {}),
  handler: jest.fn<void, Parameters<AppServer['handler']>>(),
});

const mockAuthenticate = jest.fn();
const mockGetUnauthenticatedRoles = jest.fn();
const mockGetMongodbUri = jest.fn();
const mockGetClient = jest.fn();
const mockConnect = jest.fn();
const mockRequireAccess = jest.fn();
const mockHasAccess = jest.fn();
const mockHasPermission = jest.fn();
const mockGetDefaultAuthenticatedRoles = jest.fn();
const mockInitRoles = jest.fn();
const mockRunMethod = jest.fn();
const mockGetResponseTypeMap = jest.fn();
const mockCreateRouteHandler = jest.fn();
const mockGoogleAuthRouter = jest.fn();
const mockGithubAuthRouter = jest.fn();
const mockLogInfo = jest.fn();
const mockGetWebsocketConfig = jest.fn();
const mockExpressJson = jest.fn();
const mockExpressUrlencoded = jest.fn();
const mockCookieParser = jest.fn();
const mockHttpCreateServer = jest.fn();

jest.unstable_mockModule('../auth', () => ({
  authenticate: mockAuthenticate,
}));

jest.unstable_mockModule('../auth/role', () => ({
  getUnauthenticatedRoles: mockGetUnauthenticatedRoles,
  requireAccess: mockRequireAccess,
  hasAccess: mockHasAccess,
  hasPermission: mockHasPermission,
  getDefaultAuthenticatedRoles: mockGetDefaultAuthenticatedRoles,
  initRoles: mockInitRoles,
}));

jest.unstable_mockModule('../db/client', () => ({
  getMongodbUri: mockGetMongodbUri,
  getClient: mockGetClient,
  connect: mockConnect,
}));

jest.unstable_mockModule('@/methods', () => ({
  runMethod: mockRunMethod,
}));

jest.unstable_mockModule('@/methods/serialize', () => ({
  getResponseTypeMap: mockGetResponseTypeMap,
}));

jest.unstable_mockModule('@/routes/handler', () => ({
  createRouteHandler: mockCreateRouteHandler,
}));

jest.unstable_mockModule('@/auth/providers/google', () => ({
  default: mockGoogleAuthRouter,
}));

jest.unstable_mockModule('@/auth/providers/github', () => ({
  default: mockGithubAuthRouter,
}));

jest.unstable_mockModule('@/telemetry', () => ({
  logInfo: mockLogInfo,
}));

jest.unstable_mockModule('./websocketConfig', () => ({
  getWebsocketConfig: mockGetWebsocketConfig,
}));

let mockExpressApp: MockExpressApp;
const createExpressAppMock = (): MockExpressApp => ({
  use: jest.fn(),
  post: jest.fn(),
  get: jest.fn(),
  put: jest.fn(),
  patch: jest.fn(),
  delete: jest.fn(),
  all: jest.fn(),
});

const getRegisteredMethodHandler = (app: MockExpressApp) => {
  const call = app.post.mock.calls.find(([path]) =>
    String(path).includes('/api/_internal/method/')
  );
  if (!call) {
    throw new Error('Method handler not registered');
  }
  return call[1] as (req: Request, res: Response) => Promise<unknown>;
};

jest.unstable_mockModule('express', () => {
  const express = jest.fn(() => {
    // Return the app set in beforeEach
    return mockExpressApp || createExpressAppMock();
  }) as jest.Mock & { json: jest.Mock; urlencoded: jest.Mock };
  express.json = mockExpressJson;
  express.urlencoded = mockExpressUrlencoded;
  return { default: express };
});

jest.unstable_mockModule('cookie-parser', () => ({
  default: mockCookieParser,
}));

jest.unstable_mockModule('http', () => ({
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
    json: jest.fn(),
    send: jest.fn(),
    status: jest.fn(),
    sendFile: jest.fn(),
  } as unknown as Response;
  (res.status as jest.Mock).mockReturnValue(res);
  return res;
}

describe('app/server getCallContext', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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

    const ctx = await getCallContext(req);

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

    const ctx = await getCallContext(req);

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

    const ctx = await getCallContext(req);

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

    const ctx = await getCallContext(req);

    expect(mockAuthenticate).toHaveBeenCalledWith('body-token');
    expect(ctx.session?.authToken).toBe('body-token');
  });

  test('handles null authToken', async () => {
    const req = createRequest({
      headers: { host: 'localhost' },
    });
    mockGetMongodbUri.mockReturnValue('');

    const ctx = await getCallContext(req);

    expect(ctx.session).toBeNull();
    expect(ctx.roles).toEqual(['guest']);
  });

  test('provides default clientInfo when not provided', async () => {
    const req = createRequest({
      headers: { host: 'localhost' },
    });
    mockGetMongodbUri.mockReturnValue('');

    const ctx = await getCallContext(req);

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

    const ctx = await getCallContext(req);

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

    const ctx = await getCallContext(req);

    expect(ctx.connectionInfo.ip).toBe('1.2.3.4');
  });

  test('handles X-Forwarded-For as array', async () => {
    const req = createRequest({
      headers: { host: 'localhost' },
    });
    req.headers['x-forwarded-for'] = ['1.2.3.4', '5.6.7.8'];
    mockGetMongodbUri.mockReturnValue('');

    const ctx = await getCallContext(req);

    expect(ctx.connectionInfo.ip).toBe('1.2.3.4');
  });

  test('uses socket remoteAddress when ip is not available', async () => {
    const req = createRequest({
      headers: { host: 'localhost' },
    });
    req.socket = { remoteAddress: '10.0.0.5' } as unknown as Request['socket'];
    mockGetMongodbUri.mockReturnValue('');

    const ctx = await getCallContext(req);

    expect(ctx.connectionInfo.ip).toBe('10.0.0.5');
  });
});

describe('app/server startServer', () => {
  let mockApp: MockExpressApp;
  let mockHttpServer: MockHttpServer;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    jest.clearAllMocks();
    originalEnv = { ...process.env };

    mockApp = {
      use: jest.fn(),
      post: jest.fn(),
      get: jest.fn(),
      put: jest.fn(),
      patch: jest.fn(),
      delete: jest.fn(),
      all: jest.fn(),
    };

    // Set the app that will be returned by express()
    mockExpressApp = mockApp;

    mockHttpServer = {
      listen: jest.fn(((_port: unknown, callback?: () => void) => {
        if (callback) callback();
        return mockHttpServer;
      }) as jest.Mock),
    };

    mockExpressJson.mockReturnValue('json-middleware');
    mockExpressUrlencoded.mockReturnValue('urlencoded-middleware');
    mockCookieParser.mockReturnValue('cookie-parser-middleware');
    mockGoogleAuthRouter.mockReturnValue('google-router');
    mockGithubAuthRouter.mockReturnValue('github-router');
    mockHttpCreateServer.mockReturnValue(mockHttpServer);
    mockGetWebsocketConfig.mockReturnValue(null);
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test('initializes express app with middleware', async () => {
    const mockServer = {
      ...createMockServer(),
      middlewares: jest.fn(() => ['vite-middleware']),
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
    const mockServer = {
      ...createMockServer(),
      middlewares: jest.fn(() => {
        callOrder.push('middlewares');
        return ['middleware'];
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
    const mockHandler = jest.fn<void, Parameters<AppServer['handler']>>();
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
      init: jest.fn(),
      broadcast: jest.fn(),
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
    const mockRouteHandler = jest.fn();
    mockCreateRouteHandler.mockReturnValue(mockRouteHandler);

    const mockModule = new Module('testModule', {
      routes: [
        {
          path: '/api/test',
          handlers: {
            get: jest.fn(),
            post: jest.fn(),
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
    expect(mockApp.get).toHaveBeenCalledWith('/api/test', mockRouteHandler);
    expect(mockApp.post).toHaveBeenCalledWith('/api/test', mockRouteHandler);
  });

  test('handles multiple modules with routes', async () => {
    mockCreateRouteHandler.mockReturnValue(jest.fn());

    const modules = [
      new Module('module1', {
        routes: [
          {
            path: '/api/foo',
            handlers: { get: jest.fn() },
          },
        ],
      }),
      new Module('module2', {
        routes: [
          {
            path: '/api/bar',
            handlers: { post: jest.fn() },
          },
        ],
      }),
    ];

    const mockServer = createMockServer();

    await startServer(mockServer, {
      combinedModules: modules,
      channels: [],
    });

    expect(mockApp.get).toHaveBeenCalledWith('/api/foo', expect.any(Function));
    expect(mockApp.post).toHaveBeenCalledWith('/api/bar', expect.any(Function));
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
    jest.clearAllMocks();
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
