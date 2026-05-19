import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { Mock } from 'vitest';
import type { Server } from 'http';
import type { Socket } from 'socket.io';
import type { Session, User } from '@/auth/types';
import { ServerChannel as ServerChannelClass } from '../serverChannel';

const mockCreateIndex = vi.fn();
const mockDropIndex = vi.fn();
const mockCollection = {
  createIndex: mockCreateIndex,
  dropIndex: mockDropIndex,
};
const mockCollectionFn = vi.fn(() => mockCollection);
const mockDb = {
  collection: mockCollectionFn,
};
const mockMongoClient = {
  db: vi.fn(() => mockDb),
};

const mockGetClient = vi.fn();
vi.doMock('@/db/client', () => ({
  getClient: mockGetClient,
}));

const mockCreateAdapter = vi.fn(() => 'adapter');
vi.doMock('@socket.io/mongo-adapter', () => ({
  createAdapter: mockCreateAdapter,
}));

const mockAuthenticate = vi.fn();
vi.doMock('@/auth', () => ({
  authenticate: mockAuthenticate,
}));

const mockGetConfig = vi.fn();
vi.doMock('@/config/server', () => ({
  getConfig: mockGetConfig,
}));

const eventHandlers: Record<string, ((...args: unknown[]) => void) | undefined> = {};
const socketMiddlewares: Array<(socket: Socket, next: () => void) => void> = [];
const toEmit = vi.fn();
const mockTo = vi.fn(() => ({
  emit: toEmit,
}));
const serverInstance = {
  on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
    eventHandlers[event] = handler;
  }),
  use: vi.fn((handler: (socket: Socket, next: () => void) => void) => {
    socketMiddlewares.push(handler);
  }),
  to: mockTo,
};

vi.doMock('socket.io', () => ({
  Server: vi.fn(() => serverInstance),
}));

const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

const serverModule = await import('./server');
const websocketProvider = serverModule.default;

describe('websocket/socketio/server', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(eventHandlers).forEach((key) => delete eventHandlers[key]);
    socketMiddlewares.length = 0;
    mockGetConfig.mockReturnValue(false);
    mockGetClient.mockReturnValue(mockMongoClient);
    mockCreateIndex.mockResolvedValue(undefined as never);
    mockAuthenticate.mockResolvedValue({ user: { id: '1' } } as never);
  });

  afterAll(() => {
    consoleLog.mockRestore();
    consoleError.mockRestore();
  });

  function buildSocket() {
    const socketEvents: Record<string, (...args: unknown[]) => void> = {};
    const socket = {
      id: 'socket-1',
      data: { user: { id: '1' } },
      handshake: { auth: { token: 'token' } },
      join: vi.fn(),
      leave: vi.fn(),
      emit: vi.fn(),
      on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        socketEvents[event] = handler;
      }),
    };
    return { socket: socket as unknown as Socket, socketEvents };
  }

  test('init configures socket server, middleware, and channel handlers', async () => {
    mockGetConfig.mockReturnValue(true);
    const accessSpy = vi.fn(
      async (_props: { user: User | null; session: Session | null; roles: string[] }) => true
    );
    await websocketProvider.init({
      httpServer: {} as Server,
      channels: [new ServerChannelClass('chat', accessSpy)],
    });

    expect((mockCollectionFn as Mock).mock.calls[0]?.[0]).toBe('_modelenceSocketio');
    expect(mockCreateIndex).toHaveBeenCalledWith(
      { createdAt: 1 },
      { expireAfterSeconds: 60, background: true }
    );
    expect((mockCreateAdapter as Mock).mock.calls[0]?.[0]).toBe(mockCollection);

    // Auth middleware should attach authenticated user data
    const middleware = socketMiddlewares[0];
    expect(middleware).toBeDefined();
    const next = vi.fn();
    const authSocket = { handshake: { auth: { token: 'abc' } }, data: null } as unknown as Socket;
    await middleware?.(authSocket, next);
    expect(mockAuthenticate).toHaveBeenCalledWith('abc');
    expect(authSocket.data).toEqual({ user: { id: '1' } });
    expect(next).toHaveBeenCalled();

    // Simulate connection lifecycle
    const connectionHandler = eventHandlers.connection;
    expect(connectionHandler).toBeDefined();
    const { socket, socketEvents } = buildSocket();
    connectionHandler?.(socket);

    const joinHandler = socketEvents.joinChannel;
    expect(joinHandler).toBeDefined();
    await joinHandler?.('chat:room1');
    expect(accessSpy).toHaveBeenCalledWith(socket.data);
    expect(socket.join).toHaveBeenCalledWith('chat:room1');
    expect(socket.emit).toHaveBeenCalledWith('joinedChannel', 'chat:room1');

    const leaveHandler = socketEvents.leaveChannel;
    expect(leaveHandler).toBeDefined();
    leaveHandler?.('chat:room1');
    expect(socket.leave).toHaveBeenCalledWith('chat:room1');
    expect(socket.emit).toHaveBeenCalledWith('leftChannel', 'chat:room1');
  });

  test('init skips mongo adapter when multiInstance is disabled', async () => {
    await websocketProvider.init({
      httpServer: {} as Server,
      channels: [],
    });

    expect(mockCollectionFn).not.toHaveBeenCalled();
    expect(mockCreateIndex).not.toHaveBeenCalled();
    expect(mockCreateAdapter).not.toHaveBeenCalled();
  });

  test('init drops and recreates index on IndexOptionsConflict error', async () => {
    mockGetConfig.mockReturnValue(true);
    const conflictError = Object.assign(new Error('IndexOptionsConflict'), { code: 85 });
    mockCreateIndex.mockRejectedValueOnce(conflictError as never);
    mockDropIndex.mockResolvedValue(undefined as never);
    mockCreateIndex.mockResolvedValueOnce(undefined as never);

    await websocketProvider.init({
      httpServer: {} as Server,
      channels: [],
    });

    expect(mockDropIndex).toHaveBeenCalledWith('createdAt_1');
    expect(mockCreateIndex).toHaveBeenCalledTimes(2);
  });

  test('broadcast emits messages to connected sockets when initialized', async () => {
    mockGetClient.mockReturnValue(null);
    await websocketProvider.init({
      httpServer: {} as Server,
      channels: [],
    });

    websocketProvider.broadcast({
      category: 'chat',
      id: 'room',
      data: { text: 'hello' },
    });

    expect((mockTo as Mock).mock.calls[0]?.[0]).toBe('chat:room');
    expect(toEmit).toHaveBeenCalledWith('chat', { text: 'hello' });
  });
});
