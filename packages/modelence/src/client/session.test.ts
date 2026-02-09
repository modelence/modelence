import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';

type CallMethodFn = (typeof import('./method'))['callMethod'];
const mockCallMethod = jest.fn<CallMethodFn>();
const mockSetConfig = jest.fn();
const mockSetLocalStorageSession = jest.fn();
const mockSeconds = jest.fn((value: number) => value * 1000);

jest.unstable_mockModule('./method', () => ({
  callMethod: mockCallMethod,
}));

const mockGetConfig = jest.fn();

jest.unstable_mockModule('../config/client', () => ({
  _setConfig: mockSetConfig,
  getConfig: mockGetConfig,
}));

const mockGetLocalStorageSession = jest.fn();

jest.unstable_mockModule('./localStorage', () => ({
  getLocalStorageSession: mockGetLocalStorageSession,
  setLocalStorageSession: mockSetLocalStorageSession,
}));

jest.unstable_mockModule('../time', () => ({
  time: {
    seconds: mockSeconds,
  },
}));

const mockHandleAuthChange = jest.fn();

jest.unstable_mockModule('../websocket/socketio/client', () => ({
  handleAuthChange: mockHandleAuthChange,
}));

const { initSession, setCurrentUser, useSessionStore, getHeartbeatTimer, stopHeartbeatTimer } =
  await import('./session');

describe('client/session', () => {
  const originalSetTimeout = global.setTimeout;

  beforeEach(() => {
    jest.resetModules();
    (useSessionStore.setState as unknown as jest.Mock | undefined)?.mockClear?.();
    mockCallMethod.mockReset();
    mockSetConfig.mockReset();
    mockSetLocalStorageSession.mockReset();
    mockHandleAuthChange.mockReset();
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

    expect(mockHandleAuthChange).toHaveBeenCalledWith('1');
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
    expect(mockHandleAuthChange).toHaveBeenCalledWith(null);
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
    expect(mockHandleAuthChange).toHaveBeenCalledWith(null);
  });
});
