import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createServer, type Server as HttpServer } from 'http';
import type { AddressInfo } from 'net';
import io, { type Socket as ClientSocket } from 'socket.io-client';
import { ServerChannel } from '../serverChannel';
import type { UserInfo } from '@/auth/types';

/*
  Runs the real Socket.IO server, client and live query handlers. Only the
  session lookup is replaced, with an in-memory table that resolves an unknown
  token to no user the way the real one does.
*/
const sessions = new Map<string, string>();

const authenticate = vi.fn(async (token: string | null) => {
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
});
vi.doMock('@/auth', () => ({ authenticate }));
vi.doMock('@/db/client', () => ({ getClient: () => null }));
vi.doMock('@/config/server', () => ({ getConfig: () => false }));

type LiveContext = { user: { id: string } | null };
const publishers = new Set<() => void>();
const fetchData = vi.fn(async (owner: string | null): Promise<unknown> => ({ owner }));
vi.doMock('@/methods', () => ({
  runLiveMethod: async (_method: string, _args: unknown, { user }: LiveContext) => ({
    fetch: () => fetchData(user?.id ?? null),
    watch: ({ publish }: { publish: () => void }) => {
      publishers.add(publish);
      return () => publishers.delete(publish);
    },
  }),
}));

vi.spyOn(console, 'log').mockImplementation(() => {});
const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

const { default: provider } = await import('./server');

const canAccessInbox = vi.fn(async ({ user }: { user: UserInfo | null }) => user !== null);

const publishAll = () => [...publishers].forEach((publish) => publish());

describe('websocket connections of revoked sessions', () => {
  let httpServer: HttpServer;
  let clients: ClientSocket[];

  beforeEach(async () => {
    sessions.clear();
    publishers.clear();
    vi.clearAllMocks();
    clients = [];
    httpServer = createServer();
    await provider.init({
      httpServer,
      channels: [
        new ServerChannel('inbox', canAccessInbox),
        new ServerChannel('lobby', async () => true),
        new ServerChannel('public'),
      ],
    });
    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  });

  afterEach(async () => {
    clients.forEach((client) => client.disconnect());
    await new Promise<unknown>((resolve) => httpServer.close(resolve));
  });

  async function connect(
    token: string | null | (() => string),
    options: { reconnection?: boolean } = {}
  ) {
    const { port } = httpServer.address() as AddressInfo;
    const client = io(`http://127.0.0.1:${port}`, {
      transports: ['websocket'],
      auth: (callback) => callback({ token: typeof token === 'function' ? token() : token }),
      forceNew: true,
      reconnection: false,
      reconnectionDelay: 10,
      reconnectionDelayMax: 20,
      ...options,
    });
    clients.push(client);
    await new Promise<void>((resolve, reject) => {
      client.once('connect', resolve);
      client.once('connect_error', reject);
    });
    return client;
  }

  const next = <T>(client: ClientSocket, event: string) =>
    new Promise<T>((resolve) => client.once(event, resolve));

  async function join(client: ClientSocket, channel: string) {
    const joined = Promise.race([
      next(client, 'joinedChannel').then(() => 'joined' as const),
      next(client, 'joinError').then(() => 'denied' as const),
      next(client, 'disconnect').then(() => 'disconnected' as const),
    ]);
    client.emit('joinChannel', channel);
    return joined;
  }

  function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => (resolve = done));
    return { promise, resolve };
  }

  async function subscribe(client: ClientSocket, authToken: string | null, subscriptionId = 's') {
    const first = next<{ data: unknown }>(client, 'liveQueryData');
    client.emit('subscribeLiveQuery', { subscriptionId, method: 'inbox.messages', authToken });
    return (await first).data;
  }

  /*
    To assert that nothing leaked, wait for the same client's `disconnect` before
    checking: events on one connection arrive in order, so anything sent before
    the close has arrived by then. If the close never comes, the test times out.
  */
  function record(client: ClientSocket, event: string) {
    const received: unknown[] = [];
    client.on(event, (value) => received.push(value));
    return received;
  }

  describe('live queries', () => {
    test('drop an update that was being fetched when the session was revoked', async () => {
      sessions.set('token', 'alice');
      const client = await connect('token');
      await subscribe(client, 'token');
      const received = record(client, 'liveQueryData');
      const disconnected = next(client, 'disconnect');
      const fetching = deferred<unknown>();
      fetchData.mockClear();
      fetchData.mockReturnValueOnce(fetching.promise);

      publishAll();
      await vi.waitFor(() => expect(fetchData).toHaveBeenCalledTimes(1));
      sessions.delete('token');
      await provider.revalidateUser?.('alice');
      fetching.resolve({ owner: 'alice' });
      await disconnected;

      expect(received).toEqual([]);
      expect(publishers.size).toBe(0);
    });

    test('drop an update that was queued before the disconnect', async () => {
      sessions.set('token', 'alice');
      const client = await connect('token');
      await subscribe(client, 'token');
      const [publish] = publishers;
      const disconnected = next(client, 'disconnect');

      sessions.delete('token');
      await provider.revalidateUser?.('alice');
      await disconnected;
      authenticate.mockClear();
      fetchData.mockClear();
      // A watcher may publish after its cleanup.
      publish();
      await connect(null);

      expect(authenticate).not.toHaveBeenCalledWith('token', expect.anything());
      expect(fetchData).not.toHaveBeenCalled();
    });

    test('resume under the current session after the client reconnects', async () => {
      sessions.set('token', 'alice');
      const client = await connect('token', { reconnection: true });
      await subscribe(client, 'token');

      sessions.delete('token');
      const reconnected = next(client, 'connect');
      await provider.revalidateUser?.('alice');
      await reconnected;

      expect(await subscribe(client, 'token')).toEqual({ owner: null });
    });
  });

  describe('revalidateUser', () => {
    test('drops a broadcast whose access check was running when the session was revoked', async () => {
      sessions.set('token', 'alice');
      const client = await connect('token');
      await join(client, 'inbox:alice');
      const received = record(client, 'inbox');
      const disconnected = next(client, 'disconnect');
      const checking = deferred<boolean>();
      canAccessInbox.mockClear();
      canAccessInbox.mockReturnValueOnce(checking.promise);

      provider.broadcast({ category: 'inbox', id: 'alice', data: 'secret' });
      await vi.waitFor(() => expect(canAccessInbox).toHaveBeenCalledTimes(1));
      sessions.delete('token');
      await provider.revalidateUser?.('alice');
      checking.resolve(true);
      await disconnected;

      expect(received).toEqual([]);
    });

    test('stops broadcasts to channels without an access check', async () => {
      sessions.set('token', 'alice');
      const client = await connect('token');
      await join(client, 'public:news');
      const received = record(client, 'public');
      const disconnected = next(client, 'disconnect');

      sessions.delete('token');
      await provider.revalidateUser?.('alice');
      provider.broadcast({ category: 'public', id: 'news', data: 'update' });
      await disconnected;

      expect(received).toEqual([]);
    });

    test('lets the client join again with the session it holds now', async () => {
      let token = 'old';
      sessions.set('old', 'alice');
      const client = await connect(() => token, { reconnection: true });

      sessions.delete('old');
      sessions.set('new', 'alice');
      token = 'new';
      const reconnected = next(client, 'connect');
      await provider.revalidateUser?.('alice');
      await reconnected;

      expect(await join(client, 'inbox:alice')).toBe('joined');
    });

    test('cannot be evaded by leaving rooms', async () => {
      sessions.set('token', 'alice');
      const client = await connect('token');
      await join(client, 'inbox:alice');
      for (const room of [client.id, 'alice', 'user:alice']) {
        const left = next(client, 'leftChannel');
        client.emit('leaveChannel', room);
        await left;
      }
      const received = record(client, 'inbox');
      const disconnected = next(client, 'disconnect');

      sessions.delete('token');
      await provider.revalidateUser?.('alice');
      provider.broadcast({ category: 'inbox', id: 'alice', data: 'secret' });
      await disconnected;

      expect(received).toEqual([]);
    });

    test("keeps the user's other sessions and other users connected", async () => {
      sessions.set('revoked', 'alice');
      sessions.set('other-device', 'alice');
      sessions.set('bobs', 'bob');
      const [revoked, otherDevice, bob] = [
        await connect('revoked'),
        await connect('other-device'),
        await connect('bobs'),
      ];

      const disconnected = next(revoked, 'disconnect');

      sessions.delete('revoked');
      await provider.revalidateUser?.('alice');
      await disconnected;

      // Their connections still work, and are still theirs.
      expect(await join(otherDevice, 'inbox:alice')).toBe('joined');
      expect(await join(bob, 'inbox:bob')).toBe('joined');
    });

    test('lets the client reconnect on its own', async () => {
      sessions.set('token', 'alice');
      const client = await connect('token', { reconnection: true });

      sessions.delete('token');
      const reconnected = next(client, 'connect');
      await provider.revalidateUser?.('alice');
      await reconnected;

      expect(await join(client, 'inbox:alice')).toBe('denied');
      expect(await join(client, 'lobby:main')).toBe('joined');
      expect(await join(client, 'public:news')).toBe('joined');
    });

    test('looks up each session once, however many connections share it', async () => {
      sessions.set('token', 'alice');
      await connect('token');
      await connect('token');
      authenticate.mockClear();

      await provider.revalidateUser?.('alice');

      expect(authenticate).toHaveBeenCalledTimes(1);
    });

    test('closes connections whose session cannot be checked', async () => {
      sessions.set('token', 'alice');
      const client = await connect('token');
      authenticate.mockRejectedValueOnce(new Error('database is down'));

      const disconnected = next(client, 'disconnect');
      await provider.revalidateUser?.('alice');
      await disconnected;

      expect(consoleError).toHaveBeenCalled();
    });
  });
});
