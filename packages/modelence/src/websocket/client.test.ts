import {
  setWebsocketClientProvider,
  getWebsocketClientProvider,
  startWebsockets,
} from './client';

describe('websocket/client', () => {
  describe('setWebsocketClientProvider', () => {
    it('should export setWebsocketClientProvider function', () => {
      expect(setWebsocketClientProvider).toBeDefined();
      expect(typeof setWebsocketClientProvider).toBe('function');
    });

    it('should set and get websocket client provider', () => {
      const mockProvider = {
        init: () => {},
        on: () => {},
        once: () => {},
        off: () => {},
        emit: () => {},
        joinChannel: () => {},
        leaveChannel: () => {},
      };

      setWebsocketClientProvider(mockProvider);
      expect(getWebsocketClientProvider()).toBe(mockProvider);
    });
  });

  describe('startWebsockets', () => {
    it('should export startWebsockets function', () => {
      expect(startWebsockets).toBeDefined();
      expect(typeof startWebsockets).toBe('function');
    });
  });
});
