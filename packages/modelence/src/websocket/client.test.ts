import {
  setWebsocketClientProvider,
  getWebsocketClientProvider,
  startWebsockets,
  reconnectWebsockets,
} from './client';
import { afterEach, vi } from 'vitest';

describe('websocket/client', () => {
  afterEach(() => {
    setWebsocketClientProvider(null);
  });
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

  describe('reconnectWebsockets', () => {
    it('should call reconnect on the provider if available', () => {
      const mockReconnect = vi.fn();
      const mockProvider = {
        init: () => {},
        on: () => {},
        once: () => {},
        off: () => {},
        emit: () => {},
        joinChannel: () => {},
        leaveChannel: () => {},
        reconnect: mockReconnect,
      };

      setWebsocketClientProvider(mockProvider);
      reconnectWebsockets();
      expect(mockReconnect).toHaveBeenCalledTimes(1);
    });
  });
});
