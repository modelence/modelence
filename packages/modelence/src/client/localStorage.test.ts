import { getLocalStorageSession, setLocalStorageSession } from './localStorage';

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};

  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value.toString();
    },
    clear: () => {
      store = {};
    },
    removeItem: (key: string) => {
      delete store[key];
    },
  };
})();

Object.defineProperty(global, 'localStorage', {
  value: localStorageMock,
  writable: true,
});

describe('client/localStorage', () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  describe('getLocalStorageSession', () => {
    test('should return null when no session exists', () => {
      const session = getLocalStorageSession();
      expect(session).toBeNull();
    });

    test('should return parsed session object when valid JSON exists', () => {
      const mockSession = { userId: '123', token: 'abc123' };
      localStorage.setItem('modelence.session', JSON.stringify(mockSession));

      const session = getLocalStorageSession();
      expect(session).toEqual(mockSession);
    });

    test('should return null when JSON is invalid', () => {
      const originalError = console.error;
      console.error = () => {}; // Suppress error logging

      localStorage.setItem('modelence.session', 'invalid-json{');

      const session = getLocalStorageSession();
      expect(session).toBeNull();

      console.error = originalError;
    });

    test('should handle empty string', () => {
      localStorage.setItem('modelence.session', '');
      const session = getLocalStorageSession();
      expect(session).toBeNull();
    });
  });

  describe('setLocalStorageSession', () => {
    test('should store session object as JSON string', () => {
      const mockSession = { userId: '456', token: 'xyz789' };
      setLocalStorageSession(mockSession);

      const stored = localStorage.getItem('modelence.session');
      expect(stored).toBe(JSON.stringify(mockSession));
    });

    test('should overwrite existing session', () => {
      const firstSession = { userId: '1', token: 'first' };
      const secondSession = { userId: '2', token: 'second' };

      setLocalStorageSession(firstSession);
      setLocalStorageSession(secondSession);

      const stored = localStorage.getItem('modelence.session');
      expect(stored).toBe(JSON.stringify(secondSession));
    });

    test('should handle complex nested objects', () => {
      const complexSession = {
        user: {
          id: '123',
          profile: { name: 'Test', roles: ['admin', 'user'] },
        },
        metadata: { createdAt: new Date().toISOString() },
      };

      setLocalStorageSession(complexSession);
      const retrieved = getLocalStorageSession();
      expect(retrieved).toEqual(complexSession);
    });
  });
});
