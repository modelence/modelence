import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';

type CallMethodFn = (typeof import('./method'))['callMethod'];
const mockCallMethod = jest.fn<CallMethodFn>();
const mockSetConfig = jest.fn();
const mockSetLocalStorageSession = jest.fn();
const mockSeconds = jest.fn((value: number) => value * 1000);

jest.unstable_mockModule('./method', () => ({
  callMethod: mockCallMethod,
}));

jest.unstable_mockModule('../config/client', () => ({
  _setConfig: mockSetConfig,
}));

jest.unstable_mockModule('./localStorage', () => ({
  setLocalStorageSession: mockSetLocalStorageSession,
}));

jest.unstable_mockModule('../time', () => ({
  time: {
    seconds: mockSeconds,
  },
}));

const { initSession, setCurrentUser, useSessionStore, getHeartbeatTimer, stopHeartbeatTimer } =
  await import('./session');
type SessionModule = typeof import('./session');
type HydrateSessionFn = SessionModule['hydrateSession'];

describe('client/session', () => {
  const originalSetTimeout = global.setTimeout;

  beforeEach(() => {
    jest.resetModules();
    (useSessionStore.setState as unknown as jest.Mock | undefined)?.mockClear?.();
    mockCallMethod.mockReset();
    mockSetConfig.mockReset();
    mockSetLocalStorageSession.mockReset();
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

  test('hydrateSession populates store synchronously without calling the network', async () => {
    const fresh = await import('./session');
    const payload = {
      configs: [{ key: 'site.url', value: 'https://example.com' }],
      session: { authToken: 'abc' },
      user: { id: '42', handle: 'ssr-user', roles: ['admin'] },
    };

    fresh.hydrateSession(payload as unknown as Parameters<HydrateSessionFn>[0]);

    expect(mockCallMethod).not.toHaveBeenCalled();
    expect(mockSetConfig).toHaveBeenCalledWith(payload.configs);
    expect(mockSetLocalStorageSession).toHaveBeenCalledWith(payload.session);
    expect(fresh.useSessionStore.getState().user?.id).toBe('42');
    expect(fresh.isSessionInitialized()).toBe(true);
  });

  test('hydrateSession is a no-op when session was already initialized', async () => {
    const fresh = await import('./session');
    const payload = {
      configs: [],
      session: {},
      user: null,
    };
    // First call initializes
    fresh.hydrateSession(payload as unknown as Parameters<HydrateSessionFn>[0]);
    mockSetConfig.mockClear();
    mockSetLocalStorageSession.mockClear();

    // Second call should be ignored
    fresh.hydrateSession({
      configs: [{ key: 'changed', value: 'value' }],
      session: { authToken: 'replacement' },
      user: { id: 'new', handle: 'new', roles: [] },
    } as unknown as Parameters<HydrateSessionFn>[0]);

    expect(mockSetConfig).not.toHaveBeenCalled();
    expect(mockSetLocalStorageSession).not.toHaveBeenCalled();
  });
});
