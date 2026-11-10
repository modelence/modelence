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
      address: '127.0.0.1',
      headers: { 'user-agent': 'test-agent' },
    },
    emit: vi.fn(),
  } as unknown as Socket;
}

describe('live-query/handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue({ session: null, user: null, roles: [] });
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
      subscriptionId: 'sub-1',
      method: 'testMethod',
      args: {},
    });

    // Wait for async fetch to reject
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockLogError).toHaveBeenCalledWith('[LiveQuery] Error fetching data', {
      method: 'testMethod',
      subscriptionId: 'sub-1',
      error: fetchError,
    });
    expect(socket.emit).toHaveBeenCalledWith('liveQueryError', {
      subscriptionId: 'sub-1',
      error: 'fetch failed',
    });
  });

  test('logs structured error when runLiveMethod throws', async () => {
    const socket = createMockSocket('socket-method-err');
    const methodError = new Error('method failed');
    mockRunLiveMethod.mockRejectedValue(methodError);

    await handleSubscribeLiveQuery(socket, {
      subscriptionId: 'sub-2',
      method: 'failingMethod',
      args: {},
    });

    expect(mockLogError).toHaveBeenCalledWith('[LiveQuery] Error in method', {
      method: 'failingMethod',
      subscriptionId: 'sub-2',
      error: methodError,
    });
    expect(socket.emit).toHaveBeenCalledWith('liveQueryError', {
      subscriptionId: 'sub-2',
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
      subscriptionId: 'sub-3',
      method: 'someMethod',
    });

    handleUnsubscribeLiveQuery(socket, { subscriptionId: 'sub-3' });

    expect(cleanup).toHaveBeenCalled();
    expect(mockLogError).toHaveBeenCalledWith('[LiveQuery] Error in cleanup', {
      subscriptionId: 'sub-3',
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
});
