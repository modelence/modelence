import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import type { Request, Response } from 'express';
import type { Server } from 'http';
import type { Socket } from 'socket.io';
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

const eventHandlers: Record<string, ((...args: any[]) => void) | undefined> = {};
const socketMiddlewares: Array<(socket: Socket, next: () => void) => void> = [];
const toEmit = jest.fn();
const mockTo = jest.fn(() => ({
  emit: toEmit,
}));
const serverInstance = {
  on: jest.fn((event: string, handler: (...args: any[]) => void) => {
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
    const socketEvents: Record<string, (...args: any[]) => void> = {};
    const socket = {
      id: 'socket-1',
      data: { user: { id: '1' } },
      handshake: { auth: { token: 'token' } },
      join: jest.fn(),
      leave: jest.fn(),
      emit: jest.fn(),
      on: jest.fn((event: string, handler: (...args: any[]) => void) => {
        socketEvents[event] = handler;
      }),
    };
    return { socket: socket as unknown as Socket, socketEvents };
  }

  test('init configures socket server, middleware, and channel handlers', async () => {
    const accessSpy = jest.fn(async () => true);
    await websocketProvider.init({
      httpServer: {} as Server,
      channels: [new ServerChannelClass('chat', accessSpy as any)],
    });

    expect((mockCollectionFn as jest.Mock).mock.calls[0]?.[0]).toBe('_modelenceSocketio');
    expect(mockCreateIndex).toHaveBeenCalledWith(
      { createdAt: 1 },
      { expireAfterSeconds: 3600, background: true }
    );
    expect((mockCreateAdapter as jest.Mock).mock.calls[0]?.[0]).toBe(mockCollection);

    // Auth middleware should attach authenticated user data
    const middleware = socketMiddlewares[0];
    expect(middleware).toBeDefined();
    const next = jest.fn();
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
    expect((accessSpy as jest.Mock).mock.calls[0]?.[0]).toBe(socket.data);
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
