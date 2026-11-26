import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { createServer, type Server as HttpServer } from 'http';
import type { AddressInfo } from 'net';
import type { Socket as ClientSocket } from 'socket.io-client';
import { ServerChannel } from '../serverChannel';
import type { UserInfo } from '@/auth/types';

/*
  Runs the real Socket.IO server and the real Modelence client, signing out and
  in through the client's auth functions. Only the session lookup and the auth
  method calls are replaced, with an in-memory session table.
*/
const sessions = new Map<string, string>();

vi.doMock('@/auth', () => ({
  authenticate: async (token: string | null) => {
    const userId = token ? sessions.get(token) : undefined;
    return {
      session: {
        authToken: token ?? 'anonymous',
        expiresAt: new Date(Date.now() + 60_000),
        userId: userId ?? null,
      },
      user: userId ? { id: userId, roles: [] } : null,
      roles: userId ? ['authenticated'] : [],
    };
  },
}));
vi.doMock('@/db/client', () => ({ getClient: () => null }));
vi.doMock('@/config/server', () => ({ getConfig: () => false }));
vi.doMock('@/client/session', () => ({ setCurrentUser: vi.fn() }));
vi.doMock('@/client/localStorage', () => ({
  clearLocalStorageSession: vi.fn(),
  getLocalStorageSession: vi.fn(),
  setLocalStorageSession: vi.fn(),
}));

const { default: realIo } =
  await vi.importActual<typeof import('socket.io-client')>('socket.io-client');
let clientSocket: ClientSocket | null = null;
vi.doMock('socket.io-client', () => ({
  default: (...args: Parameters<typeof realIo>) => (clientSocket = realIo(...args)),
}));

const { default: serverProvider } = await import('./server');

const callMethod = vi.fn();
vi.doMock('@/client/method', () => ({ callMethod }));
callMethod.mockImplementation(async (method: string) => {
  if (method === '_system.user.logout') {
    sessions.clear();
    await serverProvider.revalidateUser?.('alice');
    return;
  }
  if (method === '_system.user.loginWithPassword') {
    sessions.set('second', 'alice');
    return { user: { id: 'alice', handle: 'alice', roles: [] }, session: { authToken: 'second' } };
  }
  throw new Error(`Unexpected method ${method}`);
});

const { configureClient } = await import('@/client/clientConfig');
const { loginWithPassword, logout } = await import('@/auth/client');
const { startWebsockets } = await import('../client');
const { default: clientProvider } = await import('./client');

vi.spyOn(console, 'log').mockImplementation(() => {});

let httpServer: HttpServer;

beforeAll(async () => {
  httpServer = createServer();
  await serverProvider.init({
    httpServer,
    channels: [
      new ServerChannel('inbox', async ({ user }: { user: UserInfo | null }) => user !== null),
    ],
  });
  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
});

afterAll(async () => {
  clientSocket?.disconnect();
  await new Promise<unknown>((resolve) => httpServer.close(resolve));
});

const next = (event: string) =>
  new Promise<void>((resolve) =>
    clientProvider.once({ category: event, listener: () => resolve() })
  );

function joinInbox() {
  const result = Promise.race([
    next('joinedChannel').then(() => 'joined' as const),
    next('joinError').then(() => 'denied' as const),
  ]);
  clientProvider.joinChannel({ category: 'inbox', id: 'alice' });
  return result;
}

test('signing in again reconnects the WebSocket with the new session', async () => {
  let authToken: string | undefined = 'first';
  sessions.set('first', 'alice');
  const { port } = httpServer.address() as AddressInfo;
  configureClient({
    baseUrl: `http://127.0.0.1:${port}`,
    getAuthToken: () => authToken,
    setAuthToken: (token) => (authToken = token ?? undefined),
    getClientInfo: () => ({
      screenWidth: 0,
      screenHeight: 0,
      windowWidth: 0,
      windowHeight: 0,
      pixelRatio: 1,
      orientation: null,
    }),
  });

  startWebsockets();
  await next('connect');

  // The server closes the connection, and the client reconnects signed out.
  const reconnectedSignedOut = next('connect');
  await logout();
  await reconnectedSignedOut;

  await loginWithPassword({ email: 'alice@example.com', password: 'password' });

  expect(await joinInbox()).toBe('joined');
});
