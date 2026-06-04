import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Mock } from 'vitest';

type CallMethodFn = (typeof import('./method'))['callMethod'];
const mockCallMethod = vi.fn<CallMethodFn>();
const mockSetConfig = vi.fn();
const mockSetLocalStorageSession = vi.fn();
const mockGetClientConfig = vi.fn();
const mockSeconds = vi.fn((value: number) => value * 1000);

vi.doMock('./method', () => ({
  callMethod: mockCallMethod,
}));

vi.doMock('../config/client', () => ({
  _setConfig: mockSetConfig,
}));

vi.doMock('./localStorage', () => ({
  setLocalStorageSession: mockSetLocalStorageSession,
}));

vi.doMock('./clientConfig', () => ({
  getClientConfig: mockGetClientConfig,
}));

vi.doMock('../time', () => ({
  time: {
    seconds: mockSeconds,
  },
}));

const { initSession, setCurrentUser, useSessionStore, getHeartbeatTimer, stopHeartbeatTimer } =
  await import('./session');

describe('client/session', () => {
  const originalSetTimeout = global.setTimeout;

  beforeEach(() => {
    vi.resetModules();
    (useSessionStore.setState as unknown as Mock | undefined)?.mockClear?.();
    mockCallMethod.mockReset();
    mockSetConfig.mockReset();
    mockSetLocalStorageSession.mockReset();
    mockGetClientConfig.mockReset();
    mockGetClientConfig.mockReturnValue(null);
    global.setTimeout = ((fn: Parameters<typeof originalSetTimeout>[0], delay?: number) => {
      return originalSetTimeout(fn, delay);
    }) as typeof setTimeout;
  });

  afterEach(() => {
    global.setTimeout = originalSetTimeout;
    stopHeartbeatTimer();
  });

  test('initSession initializes configs, stores session, and wraps user object once', async () => {
    const user = { id: '1', handle: 'demo', roles: ['admin'] };
    mockCallMethod.mockResolvedValueOnce({
      configs: { demo: 'value' },
      session: { authToken: 'token' },
      user,
    } as never);
    mockCallMethod.mockResolvedValueOnce(undefined as never);

    await initSession();
    await initSession(); // second call should no-op

    expect(mockCallMethod).toHaveBeenCalledWith('_system.session.init');
    expect(mockSetConfig).toHaveBeenCalledWith({ demo: 'value' });
    expect(mockSetLocalStorageSession).toHaveBeenCalledWith({ authToken: 'token' });

    const { user: storedUser } = useSessionStore.getState();
    expect(storedUser?.hasRole('admin')).toBe(true);
    expect(() => storedUser?.requireRole('missing')).toThrow(
      "Access denied - role 'missing' required"
    );
    const sameRef = useSessionStore.getState().user;
    expect(storedUser).toBe(sameRef);
  });

  test('initSession delegates token storage to client config when configured', async () => {
    const mockSetAuthToken = vi.fn();
    mockGetClientConfig.mockReturnValue({ setAuthToken: mockSetAuthToken });
    mockCallMethod.mockResolvedValueOnce({
      configs: { demo: 'value' },
      session: { authToken: 'rn-token' },
      user: { id: '1', handle: 'demo', roles: [] },
    } as never);
    mockCallMethod.mockResolvedValueOnce(undefined as never);

    const { initSession: freshInitSession } = await import('./session');
    await freshInitSession();

    expect(mockSetAuthToken).toHaveBeenCalledWith('rn-token');
    expect(mockSetLocalStorageSession).not.toHaveBeenCalled();
  });

  test('initSession handles null user and schedules heartbeat', async () => {
    mockCallMethod.mockResolvedValueOnce({
      configs: {},
      session: { authToken: 'token' },
      user: null,
    } as never);
    mockCallMethod.mockResolvedValueOnce(undefined as never);

    const { initSession: freshInitSession, useSessionStore: freshStore } = await import(
      './session'
    );
    await freshInitSession();

    expect(freshStore.getState().user).toBeNull();
    expect(getHeartbeatTimer()).toBeNull();
  });

  test('setCurrentUser parses and enriches user object', () => {
    const user = {
      id: '2',
      handle: 'other',
      roles: ['editor'],
    };
    setCurrentUser(user);
    const storedUser = useSessionStore.getState().user;
    expect(storedUser?.id).toBe('2');
    expect(storedUser?.handle).toBe('other');
    expect(storedUser?.roles).toEqual(['editor']);
    expect(storedUser?.hasRole('editor')).toBe(true);
    expect(storedUser?.hasRole('admin')).toBe(false);
    expect(() => storedUser?.requireRole('missing')).toThrow(
      "Access denied - role 'missing' required"
    );
  });

  test('setCurrentUser handles null', () => {
    setCurrentUser(null);
    expect(useSessionStore.getState().user).toBeNull();
  });
});
