import { ClientChannel } from './clientChannel';

describe('websocket/clientChannel', () => {
  describe('ClientChannel constructor', () => {
    test('should create instance with category and onMessage handler', () => {
      const onMessage = (data: string) => {};
      const channel = new ClientChannel('test-category', onMessage);

      expect(channel.category).toBe('test-category');
      expect(channel).toBeInstanceOf(ClientChannel);
    });

    test('should store category property', () => {
      const channel = new ClientChannel('notifications', () => {});
      expect(channel.category).toBe('notifications');
    });

    test('should work with typed data', () => {
      const onMessage = (data: { message: string; timestamp: number }) => {};
      const channel = new ClientChannel<{ message: string; timestamp: number }>(
        'messages',
        onMessage
      );

      expect(channel.category).toBe('messages');
    });
  });

  describe('methods existence', () => {
    test('should have init method', () => {
      const channel = new ClientChannel('test', () => {});
      expect(typeof channel.init).toBe('function');
    });

    test('should have joinChannel method', () => {
      const channel = new ClientChannel('test', () => {});
      expect(typeof channel.joinChannel).toBe('function');
    });

    test('should have leaveChannel method', () => {
      const channel = new ClientChannel('test', () => {});
      expect(typeof channel.leaveChannel).toBe('function');
    });
  });

  describe('method calls without provider', () => {
    test('init should not throw when provider is not set', () => {
      const channel = new ClientChannel('test', () => {});
      expect(() => channel.init()).not.toThrow();
    });

    test('joinChannel should not throw when provider is not set', () => {
      const channel = new ClientChannel('test', () => {});
      expect(() => channel.joinChannel('channel-1')).not.toThrow();
    });

    test('leaveChannel should not throw when provider is not set', () => {
      const channel = new ClientChannel('test', () => {});
      expect(() => channel.leaveChannel('channel-1')).not.toThrow();
    });
  });

  describe('category property', () => {
    test('should store category value', () => {
      const channel = new ClientChannel('chat-room', () => {});
      expect(channel.category).toBe('chat-room');
    });

    test('should maintain category value', () => {
      const channel = new ClientChannel('notifications', () => {});
      expect(channel.category).toBe('notifications');

      // Call methods - category should still be correct
      channel.init();
      channel.joinChannel('test');
      channel.leaveChannel('test');

      expect(channel.category).toBe('notifications');
    });
  });
});
