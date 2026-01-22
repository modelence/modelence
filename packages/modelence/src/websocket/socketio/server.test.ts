import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import type { Server } from 'http';
import type { Socket } from 'socket.io';
import type { Session, User } from '@/auth/types';
import { ServerChannel as ServerChannelClass } from '../serverChannel';

const mockCreateIndex = jest.fn();
const mockCollection = {
  createIndex: mockCreateIndex,
};
const mockCollectionFn = jest.fn(() => mockCollection);
const mockDb = {
  collection: mockCollectionFn,
};
const mockMongoClient = {
  db: jest.fn(() => mockDb),
};

const mockGetClient = jest.fn();
jest.unstable_mockModule('@/db/client', () => ({
  getClient: mockGetClient,
}));

const mockCreateAdapter = jest.fn(() => 'adapter');
jest.unstable_mockModule('@socket.io/mongo-adapter', () => ({
  createAdapter: mockCreateAdapter,
}));

const mockAuthenticate = jest.fn();
jest.unstable_mockModule('@/auth', () => ({
  authenticate: mockAuthenticate,
}));

const eventHandlers: Record<string, ((...args: unknown[]) => void) | undefined> = {};
const socketMiddlewares: Array<(socket: Socket, next: () => void) => void> = [];
const toEmit = jest.fn();
const mockTo = jest.fn(() => ({
  emit: toEmit,
}));
const serverInstance = {
  on: jest.fn((event: string, handler: (...args: unknown[]) => void) => {
    eventHandlers[event] = handler;
  }),
  use: jest.fn((handler: (socket: Socket, next: () => void) => void) => {
    socketMiddlewares.push(handler);
  }),
  to: mockTo,
};

jest.unstable_mockModule('socket.io', () => ({
  Server: jest.fn(() => serverInstance),
}));

const consoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});
const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

const serverModule = await import('./server');
const websocketProvider = serverModule.default;

describe('websocket/socketio/server', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.keys(eventHandlers).forEach((key) => delete eventHandlers[key]);
    socketMiddlewares.length = 0;
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
      handshake: {
        auth: { token: 'token' },
        address: '127.0.0.1',
        headers: {
          'user-agent': 'test-agent',
          'accept-language': 'en-US',
          referer: 'http://localhost',
        },
      },
      join: jest.fn(),
      leave: jest.fn(),
      emit: jest.fn(),
      on: jest.fn((event: string, handler: (...args: unknown[]) => void) => {
        socketEvents[event] = handler;
      }),
    };
    return { socket: socket as unknown as Socket, socketEvents };
  }

  test('init configures socket server, middleware, and channel handlers', async () => {
    const accessSpy = jest.fn(
      async (_props: { user: User | null; session: Session | null; roles: string[] }) => true
    );
    await websocketProvider.init({
      httpServer: {} as Server,
      channels: [new ServerChannelClass('chat', accessSpy)],
    });

    expect((mockCollectionFn as jest.Mock).mock.calls[0]?.[0]).toBe('_modelenceSocketio');
    expect(mockCreateIndex).toHaveBeenCalledWith(
      { createdAt: 1 },
      { expireAfterSeconds: 3600, background: true }
    );
    expect((mockCreateAdapter as jest.Mock).mock.calls[0]?.[0]).toBe(mockCollection);

    // Middleware should initialize socket.data with connection info
    const middleware = socketMiddlewares[0];
    expect(middleware).toBeDefined();
    const next = jest.fn();
    const authSocket = {
      handshake: {
        auth: { token: 'abc' },
        address: '127.0.0.1',
        headers: {
          'user-agent': 'test-agent',
          'accept-language': 'en-US',
          referer: 'http://localhost',
        },
      },
      data: null,
    } as unknown as Socket;
    await middleware?.(authSocket, next);
    // Middleware no longer authenticates - it just stores connection info
    expect(authSocket.data).toEqual({
      connectionInfo: {
        ip: '127.0.0.1',
        userAgent: 'test-agent',
        acceptLanguage: 'en-US',
        referrer: 'http://localhost',
      },
    });
    expect(next).toHaveBeenCalled();

    // Simulate connection lifecycle
    const connectionHandler = eventHandlers.connection;
    expect(connectionHandler).toBeDefined();
    const { socket, socketEvents } = buildSocket();
    connectionHandler?.(socket);

    const joinHandler = socketEvents.joinChannel;
    expect(joinHandler).toBeDefined();
    await joinHandler?.({ channelName: 'chat:room1', authToken: 'token' });
    expect(mockAuthenticate).toHaveBeenCalledWith('token');
    expect(accessSpy).toHaveBeenCalled();
    expect(socket.join).toHaveBeenCalledWith('chat:room1');
    expect(socket.emit).toHaveBeenCalledWith('joinedChannel', 'chat:room1');

    const leaveHandler = socketEvents.leaveChannel;
    expect(leaveHandler).toBeDefined();
    leaveHandler?.('chat:room1');
    expect(socket.leave).toHaveBeenCalledWith('chat:room1');
    expect(socket.emit).toHaveBeenCalledWith('leftChannel', 'chat:room1');
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

    expect((mockTo as jest.Mock).mock.calls[0]?.[0]).toBe('chat:room');
    expect(toEmit).toHaveBeenCalledWith('chat', { text: 'hello' });
  });
});
