import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { Socket } from 'socket.io';

const mockLogError = vi.fn();
const mockAuthenticate = vi.fn();
const mockRunLiveMethod = vi.fn();

vi.doMock('@/telemetry', () => ({
  logError: mockLogError,
}));

vi.doMock('../auth', () => ({
  authenticate: mockAuthenticate,
}));

vi.doMock('../methods', () => ({
  runLiveMethod: mockRunLiveMethod,
}));

vi.doMock('../methods/serialize', () => ({
  getResponseTypeMap: vi.fn().mockReturnValue({}),
  sanitizeResult: vi.fn((val) => val),
}));

const { handleSubscribeLiveQuery, handleUnsubscribeLiveQuery, handleLiveQueryDisconnect } =
  await import('./handlers');

function createMockSocket(id = 'socket-1'): Socket {
  return {
    id,
    handshake: {
      address: '203.0.113.7',
      headers: { 'user-agent': 'test-agent' },
    },
    emit: vi.fn(),
  } as unknown as Socket;
}

describe('live-query/handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue({ session: null, user: null, roles: [] });
    mockRunLiveMethod.mockRejectedValue(new Error('stop after authentication'));
  });

  test('does not save a new session for a subscription with a missing or unknown token', async () => {
    const socket = createMockSocket('socket-1');

    await handleSubscribeLiveQuery(socket, {
      subscriptionId: 'sub-1',
      method: 'todos.list',
      authToken: 'unknown-token',
    });

    // The subscription never returns a token to the client, so a new
    // session created here could never be used.
    expect(mockAuthenticate).toHaveBeenCalledWith('unknown-token', { persistNewSession: false });
  });

  test('authenticates a subscription without a token the same way', async () => {
    const socket = createMockSocket('socket-2');

    await handleSubscribeLiveQuery(socket, { subscriptionId: 'sub-2', method: 'todos.list' });

    expect(mockAuthenticate).toHaveBeenCalledWith(null, { persistNewSession: false });
  });

  test('logs structured error when liveData.fetch() fails', async () => {
    const socket = createMockSocket('socket-fetch-err');
    const fetchError = new Error('fetch failed');
    const mockLiveData = {
      fetch: vi.fn().mockRejectedValue(fetchError),
      watch: vi.fn().mockReturnValue(vi.fn()),
    };
    mockRunLiveMethod.mockResolvedValue(mockLiveData);

    await handleSubscribeLiveQuery(socket, {
      subscriptionId: 'sub-fetch',
      method: 'testMethod',
      args: {},
    });

    await vi.waitFor(() => {
      expect(mockLogError).toHaveBeenCalledWith('[LiveQuery] Error fetching data', {
        method: 'testMethod',
        subscriptionId: 'sub-fetch',
        error: fetchError,
      });
    });

    expect(socket.emit).toHaveBeenCalledWith('liveQueryError', {
      subscriptionId: 'sub-fetch',
      error: 'fetch failed',
    });
  });

  test('logs structured error when runLiveMethod throws', async () => {
    const socket = createMockSocket('socket-method-err');
    const methodError = new Error('method failed');
    mockRunLiveMethod.mockRejectedValue(methodError);

    await handleSubscribeLiveQuery(socket, {
      subscriptionId: 'sub-method',
      method: 'failingMethod',
      args: {},
    });

    expect(mockLogError).toHaveBeenCalledWith('[LiveQuery] Error in method', {
      method: 'failingMethod',
      subscriptionId: 'sub-method',
      error: methodError,
    });
    expect(socket.emit).toHaveBeenCalledWith('liveQueryError', {
      subscriptionId: 'sub-method',
      error: 'method failed',
    });
  });

  test('logs structured error with subscriptionId when unsubscribe cleanup throws', async () => {
    const socket = createMockSocket('socket-unsub-err');
    const cleanupError = new Error('cleanup failed');
    const cleanup = vi.fn().mockImplementation(() => {
      throw cleanupError;
    });
    const mockLiveData = {
      fetch: vi.fn().mockResolvedValue({ data: 'ok' }),
      watch: vi.fn().mockReturnValue(cleanup),
    };
    mockRunLiveMethod.mockResolvedValue(mockLiveData);

    await handleSubscribeLiveQuery(socket, {
      subscriptionId: 'sub-unsub',
      method: 'someMethod',
    });

    handleUnsubscribeLiveQuery(socket, { subscriptionId: 'sub-unsub' });

    expect(cleanup).toHaveBeenCalled();
    expect(mockLogError).toHaveBeenCalledWith('[LiveQuery] Error in cleanup', {
      subscriptionId: 'sub-unsub',
      error: cleanupError,
    });
  });

  test('logs structured error with subscriptionId and socketId on disconnect cleanup error', async () => {
    const socket = createMockSocket('socket-disconnect-err');
    const cleanupError = new Error('disconnect cleanup boom');
    const cleanup = vi.fn().mockImplementation(() => {
      throw cleanupError;
    });
    const mockLiveData = {
      fetch: vi.fn().mockResolvedValue({ data: 'ok' }),
      watch: vi.fn().mockReturnValue(cleanup),
    };
    mockRunLiveMethod.mockResolvedValue(mockLiveData);

    await handleSubscribeLiveQuery(socket, {
      subscriptionId: 'sub-disc',
      method: 'watchSomething',
    });

    handleLiveQueryDisconnect(socket);

    expect(cleanup).toHaveBeenCalled();
    expect(mockLogError).toHaveBeenCalledWith('[LiveQuery] Error in cleanup on disconnect', {
      socketId: 'socket-disconnect-err',
      subscriptionId: 'sub-disc',
      error: cleanupError,
    });
  });

  test('logs structured error when cleaning up existing subscription with same subscriptionId', async () => {
    const socket = createMockSocket('socket-dup-sub');
    const existingCleanupError = new Error('existing cleanup failed');
    const cleanup = vi.fn().mockImplementation(() => {
      throw existingCleanupError;
    });
    const mockLiveData = {
      fetch: vi.fn().mockResolvedValue({ data: 'ok' }),
      watch: vi.fn().mockReturnValue(cleanup),
    };
    mockRunLiveMethod.mockResolvedValue(mockLiveData);

    await handleSubscribeLiveQuery(socket, {
      subscriptionId: 'sub-dup',
      method: 'methodA',
    });

    await handleSubscribeLiveQuery(socket, {
      subscriptionId: 'sub-dup',
      method: 'methodB',
    });

    expect(cleanup).toHaveBeenCalled();
    expect(mockLogError).toHaveBeenCalledWith(
      '[LiveQuery] Error cleaning up existing subscription',
      {
        subscriptionId: 'sub-dup',
        error: existingCleanupError,
      }
    );
  });

  test('logs structured error when cleanup fails after disconnect during setup', async () => {
    const socket = createMockSocket('socket-disconnect-during-setup');
    const setupDisconnectError = new Error('disconnect during setup cleanup boom');
    const cleanup = vi.fn().mockImplementation(() => {
      throw setupDisconnectError;
    });

    mockRunLiveMethod.mockImplementation(async () => {
      handleLiveQueryDisconnect(socket);
      return {
        fetch: vi.fn().mockResolvedValue({ data: 'ok' }),
        watch: vi.fn().mockReturnValue(cleanup),
      };
    });

    await handleSubscribeLiveQuery(socket, {
      subscriptionId: 'sub-setup-disc',
      method: 'slowSetupMethod',
    });

    expect(cleanup).toHaveBeenCalled();
    expect(mockLogError).toHaveBeenCalledWith(
      '[LiveQuery] Error cleaning up after disconnect during setup',
      {
        subscriptionId: 'sub-setup-disc',
        error: setupDisconnectError,
      }
    );
  });
});
