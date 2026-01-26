import { describe, test, expect, jest, beforeEach } from '@jest/globals';
import type { Socket } from 'socket.io-client';
import type ioClientFactory from 'socket.io-client';
import type { ClientChannel } from '../clientChannel';
import type { getLocalStorageSession } from '@/client/localStorage';

type SocketMethods = Pick<Socket, 'on' | 'once' | 'off' | 'emit'>;
const mockSocket: jest.Mocked<SocketMethods> = {
  on: jest.fn(),
  once: jest.fn(),
  off: jest.fn(),
  emit: jest.fn(),
};

type IoFactory = typeof ioClientFactory;
const mockIo: jest.MockedFunction<IoFactory> = jest.fn(() => mockSocket as unknown as Socket);
type LocalStorageSession = ReturnType<typeof getLocalStorageSession>;
const mockGetLocalStorageSession = jest.fn<() => LocalStorageSession>();

const createMockChannel = (category: string): ClientChannel => {
  const channel = {
    category,
    init: jest.fn(),
    joinChannel: jest.fn(),
    leaveChannel: jest.fn(),
  };
  // Add private property via type assertion
  return channel as unknown as ClientChannel;
};

jest.unstable_mockModule('socket.io-client', () => ({
  default: mockIo,
}));

jest.unstable_mockModule('@/client/localStorage', () => ({
  getLocalStorageSession: mockGetLocalStorageSession,
  setLocalStorageSession: jest.fn(),
}));

const websocketProvider = (await import('./client')).default;

describe('websocket/socketio/client', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetLocalStorageSession.mockReturnValue(null);
  });

  describe('init', () => {
    test('initializes socket.io client with correct configuration', () => {
      mockGetLocalStorageSession.mockReturnValue({ authToken: 'test-token' });

      websocketProvider.init({ channels: [] });

      expect(mockIo).toHaveBeenCalledWith('/', {
        auth: {
          token: 'test-token',
        },
      });
    });

    test('initializes with undefined token when no session exists', () => {
      mockGetLocalStorageSession.mockReturnValue(null);

      websocketProvider.init({ channels: [] });

      expect(mockIo).toHaveBeenCalledWith('/', {
        auth: {
          token: undefined,
        },
      });
    });

    test('initializes channels when provided', () => {
      const mockChannel1 = createMockChannel('channel1');
      const mockChannel2 = createMockChannel('channel2');

      websocketProvider.init({ channels: [mockChannel1, mockChannel2] });

      expect(mockChannel1.init).toHaveBeenCalledTimes(1);
      expect(mockChannel2.init).toHaveBeenCalledTimes(1);
    });

    test('handles init without channels', () => {
      websocketProvider.init({});

      expect(mockIo).toHaveBeenCalled();
      // Should complete without error
    });

    test('initializes socket before initializing channels', () => {
      const callOrder: string[] = [];
      const mockChannel = {
        init: jest.fn(() => callOrder.push('channel.init')),
        category: 'test',
        joinChannel: jest.fn(),
        leaveChannel: jest.fn(),
      } as unknown as ClientChannel;

      mockIo.mockImplementationOnce(() => {
        callOrder.push('io');
        return mockSocket as unknown as Socket;
      });

      websocketProvider.init({ channels: [mockChannel] });

      expect(callOrder).toEqual(['io', 'channel.init']);
    });
  });

  describe('on', () => {
    beforeEach(() => {
      websocketProvider.init({});
    });

    test('registers event listener on socket', () => {
      const listener = jest.fn();

      websocketProvider.on({
        category: 'messages',
        listener,
      });

      expect(mockSocket.on).toHaveBeenCalledWith('messages', listener);
    });

    test('can register multiple listeners for same category', () => {
      const listener1 = jest.fn();
      const listener2 = jest.fn();

      websocketProvider.on({ category: 'updates', listener: listener1 });
      websocketProvider.on({ category: 'updates', listener: listener2 });

      // 4 listeners from init (connect, joinedChannel, joinError, leftChannel) + 2 user listeners = 6
      expect(mockSocket.on).toHaveBeenCalledTimes(6);
      expect(mockSocket.on).toHaveBeenCalledWith('updates', listener1);
      expect(mockSocket.on).toHaveBeenCalledWith('updates', listener2);
    });

    test('can register listeners for different categories', () => {
      const listener1 = jest.fn();
      const listener2 = jest.fn();

      websocketProvider.on({ category: 'messages', listener: listener1 });
      websocketProvider.on({ category: 'notifications', listener: listener2 });

      expect(mockSocket.on).toHaveBeenCalledWith('messages', listener1);
      expect(mockSocket.on).toHaveBeenCalledWith('notifications', listener2);
    });
  });

  describe('once', () => {
    beforeEach(() => {
      websocketProvider.init({});
    });

    test('registers one-time event listener on socket', () => {
      const listener = jest.fn();

      websocketProvider.once({
        category: 'connect',
        listener,
      });

      expect(mockSocket.once).toHaveBeenCalledWith('connect', listener);
    });

    test('can register multiple once listeners', () => {
      const listener1 = jest.fn();
      const listener2 = jest.fn();

      websocketProvider.once({ category: 'ready', listener: listener1 });
      websocketProvider.once({ category: 'ready', listener: listener2 });

      expect(mockSocket.once).toHaveBeenCalledTimes(2);
    });
  });

  describe('off', () => {
    beforeEach(() => {
      websocketProvider.init({});
    });

    test('removes event listener from socket', () => {
      const listener = jest.fn();

      websocketProvider.off({
        category: 'messages',
        listener,
      });

      expect(mockSocket.off).toHaveBeenCalledWith('messages', listener);
    });

    test('can remove specific listener while keeping others', () => {
      const listener1 = jest.fn();
      const listener2 = jest.fn();

      websocketProvider.off({ category: 'updates', listener: listener1 });

      expect(mockSocket.off).toHaveBeenCalledWith('updates', listener1);
      expect(mockSocket.off).not.toHaveBeenCalledWith('updates', listener2);
    });

    test('can remove listeners from different categories', () => {
      const listener1 = jest.fn();
      const listener2 = jest.fn();

      websocketProvider.off({ category: 'messages', listener: listener1 });
      websocketProvider.off({ category: 'notifications', listener: listener2 });

      expect(mockSocket.off).toHaveBeenCalledWith('messages', listener1);
      expect(mockSocket.off).toHaveBeenCalledWith('notifications', listener2);
    });
  });

  describe('emit', () => {
    beforeEach(() => {
      websocketProvider.init({});
    });

    test('emits event with formatted channel identifier', () => {
      websocketProvider.emit({
        eventName: 'subscribe',
        category: 'chat',
        id: '123',
      });

      expect(mockSocket.emit).toHaveBeenCalledWith('subscribe', 'chat:123');
    });

    test('formats channel identifier with category and id', () => {
      websocketProvider.emit({
        eventName: 'update',
        category: 'room',
        id: 'abc-456',
      });

      expect(mockSocket.emit).toHaveBeenCalledWith('update', 'room:abc-456');
    });

    test('emits multiple events with different identifiers', () => {
      websocketProvider.emit({
        eventName: 'action1',
        category: 'type1',
        id: 'id1',
      });

      websocketProvider.emit({
        eventName: 'action2',
        category: 'type2',
        id: 'id2',
      });

      expect(mockSocket.emit).toHaveBeenCalledWith('action1', 'type1:id1');
      expect(mockSocket.emit).toHaveBeenCalledWith('action2', 'type2:id2');
    });
  });

  describe('joinChannel', () => {
    beforeEach(() => {
      websocketProvider.init({});
    });

    test('emits joinChannel event with formatted identifier', () => {
      websocketProvider.joinChannel({
        category: 'room',
        id: '42',
      });

      expect(mockSocket.emit).toHaveBeenCalledWith('joinChannel', {
        channelName: 'room:42',
        authToken: undefined,
      });
    });

    test('can join multiple channels', () => {
      websocketProvider.joinChannel({ category: 'chat', id: '1' });
      websocketProvider.joinChannel({ category: 'chat', id: '2' });
      websocketProvider.joinChannel({ category: 'notifications', id: 'user-123' });

      expect(mockSocket.emit).toHaveBeenCalledWith('joinChannel', {
        channelName: 'chat:1',
        authToken: undefined,
      });
      expect(mockSocket.emit).toHaveBeenCalledWith('joinChannel', {
        channelName: 'chat:2',
        authToken: undefined,
      });
      expect(mockSocket.emit).toHaveBeenCalledWith('joinChannel', {
        channelName: 'notifications:user-123',
        authToken: undefined,
      });
      expect(mockSocket.emit).toHaveBeenCalledTimes(3);
    });
  });

  describe('leaveChannel', () => {
    beforeEach(() => {
      websocketProvider.init({});
    });

    test('emits leaveChannel event with formatted identifier', () => {
      websocketProvider.leaveChannel({
        category: 'room',
        id: '42',
      });

      expect(mockSocket.emit).toHaveBeenCalledWith('leaveChannel', 'room:42');
    });

    test('can leave multiple channels', () => {
      websocketProvider.leaveChannel({ category: 'chat', id: '1' });
      websocketProvider.leaveChannel({ category: 'chat', id: '2' });

      expect(mockSocket.emit).toHaveBeenCalledWith('leaveChannel', 'chat:1');
      expect(mockSocket.emit).toHaveBeenCalledWith('leaveChannel', 'chat:2');
      expect(mockSocket.emit).toHaveBeenCalledTimes(2);
    });

    test('leaves channel with same channelName as join', () => {
      websocketProvider.joinChannel({ category: 'lobby', id: 'main' });
      websocketProvider.leaveChannel({ category: 'lobby', id: 'main' });

      const joinCall = mockSocket.emit.mock.calls.find(
        ([eventName]) => eventName === 'joinChannel'
      );
      const leaveCall = mockSocket.emit.mock.calls.find(
        ([eventName]) => eventName === 'leaveChannel'
      );

      expect(joinCall).toBeDefined();
      expect(leaveCall).toBeDefined();
      // Join sends an object with channelName, leave sends just the channelName string
      expect(joinCall?.[1]).toEqual({ channelName: 'lobby:main', authToken: undefined });
      expect(leaveCall?.[1]).toBe('lobby:main');
    });

    test('handles race condition: leaveChannel called before joinedChannel arrives', () => {
      // Find the joinedChannel event handler registered during init
      const joinedChannelHandler = mockSocket.on.mock.calls.find(
        ([eventName]) => eventName === 'joinedChannel'
      )?.[1] as (channelName: string) => void;

      const leftChannelHandler = mockSocket.on.mock.calls.find(
        ([eventName]) => eventName === 'leftChannel'
      )?.[1] as (channelName: string) => void;

      expect(joinedChannelHandler).toBeDefined();
      expect(leftChannelHandler).toBeDefined();

      const channelName = 'chat:race-test';

      // Simulate race condition: join, then leave before joinedChannel arrives
      websocketProvider.joinChannel({ category: 'chat', id: 'race-test' });
      websocketProvider.leaveChannel({ category: 'chat', id: 'race-test' });

      // Verify leave was emitted
      expect(mockSocket.emit).toHaveBeenCalledWith('leaveChannel', channelName);

      // Now simulate joinedChannel arriving after leaveChannel was called
      // This should NOT add the channel back to activeChannels
      joinedChannelHandler(channelName);

      // Simulate leftChannel confirmation from server
      leftChannelHandler(channelName);

      // Verify that on reconnect, this channel would not be rejoined
      // (We can't directly test activeChannels, but we can verify the handlers work correctly)
      // The key is that joinedChannel handler should check pendingLeaves and not add it
    });

    test('registers leftChannel event listener', () => {
      websocketProvider.init({});

      expect(mockSocket.on).toHaveBeenCalledWith('leftChannel', expect.any(Function));
    });
  });

  describe('websocketProvider interface', () => {
    test('exports all required methods', () => {
      expect(websocketProvider.init).toBeDefined();
      expect(websocketProvider.on).toBeDefined();
      expect(websocketProvider.once).toBeDefined();
      expect(websocketProvider.off).toBeDefined();
      expect(websocketProvider.emit).toBeDefined();
      expect(websocketProvider.joinChannel).toBeDefined();
      expect(websocketProvider.leaveChannel).toBeDefined();
    });

    test('all methods are functions', () => {
      expect(typeof websocketProvider.init).toBe('function');
      expect(typeof websocketProvider.on).toBe('function');
      expect(typeof websocketProvider.once).toBe('function');
      expect(typeof websocketProvider.off).toBe('function');
      expect(typeof websocketProvider.emit).toBe('function');
      expect(typeof websocketProvider.joinChannel).toBe('function');
      expect(typeof websocketProvider.leaveChannel).toBe('function');
    });
  });

  describe('integration scenarios', () => {
    test('typical workflow: init, join channel, listen for events, leave channel', () => {
      const listener = jest.fn();

      // Initialize
      websocketProvider.init({});

      // Join a channel
      websocketProvider.joinChannel({ category: 'chat', id: 'general' });

      // Listen for messages
      websocketProvider.on({ category: 'message', listener });

      // Leave channel
      websocketProvider.leaveChannel({ category: 'chat', id: 'general' });

      // Cleanup listener
      websocketProvider.off({ category: 'message', listener });

      expect(mockSocket.emit).toHaveBeenCalledWith('joinChannel', {
        channelName: 'chat:general',
        authToken: undefined,
      });
      expect(mockSocket.on).toHaveBeenCalledWith('message', listener);
      expect(mockSocket.emit).toHaveBeenCalledWith('leaveChannel', 'chat:general');
      expect(mockSocket.off).toHaveBeenCalledWith('message', listener);
    });

    test('handles authentication flow with session token', () => {
      mockGetLocalStorageSession.mockReturnValue({
        authToken: 'authenticated-token',
        userId: 'user-123',
      });

      websocketProvider.init({});

      expect(mockIo).toHaveBeenCalledWith('/', {
        auth: {
          token: 'authenticated-token',
        },
      });
    });

    test('handles multiple channels initialization', () => {
      const channels: ClientChannel[] = [
        createMockChannel('messages'),
        createMockChannel('notifications'),
        createMockChannel('presence'),
      ];

      websocketProvider.init({ channels });

      channels.forEach((channel) => {
        expect(channel.init).toHaveBeenCalledTimes(1);
      });
    });

    test('can subscribe and unsubscribe to same category multiple times', () => {
      websocketProvider.init({});

      const listener1 = jest.fn();
      const listener2 = jest.fn();

      // Subscribe
      websocketProvider.on({ category: 'updates', listener: listener1 });
      websocketProvider.on({ category: 'updates', listener: listener2 });

      // Unsubscribe one
      websocketProvider.off({ category: 'updates', listener: listener1 });

      // 4 listeners from init (connect, joinedChannel, joinError, leftChannel) + 2 user listeners = 6
      expect(mockSocket.on).toHaveBeenCalledTimes(6);
      expect(mockSocket.off).toHaveBeenCalledTimes(1);
      expect(mockSocket.off).toHaveBeenCalledWith('updates', listener1);
    });
  });
});
