import socketioServer from './server';

describe('websocket/socketio/server', () => {
  describe('exports', () => {
    it('should export init function', () => {
      expect(socketioServer.init).toBeDefined();
      expect(typeof socketioServer.init).toBe('function');
    });

    it('should export broadcast function', () => {
      expect(socketioServer.broadcast).toBeDefined();
      expect(typeof socketioServer.broadcast).toBe('function');
    });
  });

  describe('broadcast', () => {
    it('should not throw when broadcasting without initialization', () => {
      expect(() => {
        socketioServer.broadcast({
          category: 'testCategory',
          id: '123',
          data: { message: 'test' },
        });
      }).not.toThrow();
    });
  });
});
