import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { Socket } from 'socket.io';

const mockAuthenticate = vi.fn();
const mockRunLiveMethod = vi.fn();

vi.doMock('../auth', () => ({
  authenticate: mockAuthenticate,
}));

vi.doMock('../methods', () => ({
  runLiveMethod: mockRunLiveMethod,
}));

const { handleSubscribeLiveQuery } = await import('./handlers');

function buildSocket(id: string) {
  return {
    id,
    emit: vi.fn(),
    handshake: { address: '203.0.113.7', headers: { 'user-agent': 'test-agent' } },
  } as unknown as Socket;
}

describe('live-query/handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue({ session: null, user: null, roles: [] });
    mockRunLiveMethod.mockRejectedValue(new Error('stop after authentication'));
  });

  test('does not save a new session for a subscription with a missing or unknown token', async () => {
    const socket = buildSocket('socket-1');

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
    const socket = buildSocket('socket-2');

    await handleSubscribeLiveQuery(socket, { subscriptionId: 'sub-2', method: 'todos.list' });

    expect(mockAuthenticate).toHaveBeenCalledWith(null, { persistNewSession: false });
  });

  test('stops publishing after the subscriber loses access', async () => {
    const socket = buildSocket('socket-revoked');
    const cleanup = vi.fn();
    const fetch = vi.fn().mockResolvedValue([{ secret: 'private' }]);
    let publish: (() => void) | undefined;
    const authenticated = {
      session: { authToken: 'token', expiresAt: new Date(Date.now() + 60_000) },
      user: { id: 'user-1', roles: ['reader'] },
      roles: ['reader'],
    };
    mockAuthenticate.mockResolvedValue(authenticated);
    mockRunLiveMethod.mockResolvedValue({
      fetch,
      watch: ({ publish: callback }: { publish: () => void }) => {
        publish = callback;
        return cleanup;
      },
    });

    await handleSubscribeLiveQuery(socket, {
      subscriptionId: 'sub-revoked',
      method: 'secrets.list',
      authToken: 'token',
    });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

    mockAuthenticate.mockResolvedValue({
      ...authenticated,
      user: null,
      roles: [],
    });
    publish?.();
    await vi.waitFor(() => expect(cleanup).toHaveBeenCalledTimes(1));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(socket.emit).toHaveBeenCalledTimes(1);
  });
});
