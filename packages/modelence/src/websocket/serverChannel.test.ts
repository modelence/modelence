import { ServerChannel } from './serverChannel';

describe('websocket/serverChannel', () => {
  describe('constructor', () => {
    it('should create a server channel with category', () => {
      const channel = new ServerChannel('testCategory');
      expect(channel.category).toBe('testCategory');
      expect(channel.canAccessChannel).toBeNull();
    });

    it('should create a server channel with access control', () => {
      const canAccess = async () => true;
      const channel = new ServerChannel('testCategory', canAccess);
      expect(channel.category).toBe('testCategory');
      expect(channel.canAccessChannel).toBe(canAccess);
    });
  });

  describe('broadcast', () => {
    it('should have a broadcast method', () => {
      const channel = new ServerChannel('testCategory');
      expect(channel.broadcast).toBeDefined();
      expect(typeof channel.broadcast).toBe('function');
    });

    it('should accept id and data parameters', () => {
      const channel = new ServerChannel<{ message: string }>('testCategory');
      // Should not throw when called with proper parameters
      expect(() => {
        channel.broadcast('123', { message: 'test' });
      }).not.toThrow();
    });
  });
});
