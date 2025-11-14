import { describe, expect, jest, test, beforeEach } from '@jest/globals';
import { ObjectId } from 'mongodb';
import type { Request } from 'express';

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

const { getCallContext } = await import('./server');

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
});
