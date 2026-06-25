import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Mock } from 'vitest';

type CallMethodFn = (typeof import('./method'))['callMethod'];
const mockCallMethod = vi.fn<CallMethodFn>();
const mockSetConfig = vi.fn();
const mockSetLocalStorageSession = vi.fn();
const mockGetLocalStorageSession = vi.fn<() => object | null>(() => null);
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
  getLocalStorageSession: mockGetLocalStorageSession,
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
type SessionModule = typeof import('./session');
type HydrateSessionFn = SessionModule['hydrateSession'];

describe('client/session', () => {
  const originalSetTimeout = global.setTimeout;

  beforeEach(() => {
    vi.resetModules();
    (useSessionStore.setState as unknown as Mock | undefined)?.mockClear?.();
    mockCallMethod.mockReset();
    mockSetConfig.mockReset();
    mockSetLocalStorageSession.mockReset();
    mockGetLocalStorageSession.mockReset();
    mockGetLocalStorageSession.mockReturnValue(null);
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

  test('useSession reads from injected SSR resolver when window is undefined', async () => {
    const fresh = await import('./session');
    const originalWindow = (globalThis as { window?: unknown }).window;
    delete (globalThis as { window?: unknown }).window;
    try {
      fresh._setSsrSessionResolver(() =>
        fresh._parseSessionUser({ id: 'ssr', handle: 'ssr-user', roles: ['admin'] })
      );
      expect(fresh.useSession().user?.id).toBe('ssr');
    } finally {
      fresh._setSsrSessionResolver(null);
      if (originalWindow !== undefined) {
        (globalThis as { window?: unknown }).window = originalWindow;
      }
    }
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

  test('hydrateSession preserves localStorage token when SSR was rendered anonymously', async () => {
    // Regression: previously `hydrateSession` would overwrite localStorage with
    // the freshly-minted anonymous SSR token, destroying a user's pre-existing
    // auth and logging them out permanently.
    mockGetLocalStorageSession.mockReturnValue({ authToken: 'real-localstorage-token' });

    const fresh = await import('./session');
    const payload = {
      configs: [],
      session: { authToken: 'fresh-anonymous-ssr-token' },
      user: null,
    };

    fresh.hydrateSession(payload as unknown as Parameters<HydrateSessionFn>[0]);

    // The anonymous SSR token must NOT clobber the real localStorage token.
    expect(mockSetLocalStorageSession).not.toHaveBeenCalled();
    // Reconciliation must be flagged so AppProvider can repair via initSession.
    expect(fresh._isReconciliationPending()).toBe(true);
    // Session is still marked initialized so AppProvider matches the server.
    expect(fresh.isSessionInitialized()).toBe(true);
  });

  test('hydrateSession overwrites localStorage when SSR is authoritative (user present)', async () => {
    // When the SSR payload has a real user, the server's authToken IS the
    // source of truth — overwrite localStorage as normal.
    mockGetLocalStorageSession.mockReturnValue({ authToken: 'stale-token' });

    const fresh = await import('./session');
    const payload = {
      configs: [],
      session: { authToken: 'authoritative-ssr-token' },
      user: { id: '1', handle: 'u', roles: [] },
    };

    fresh.hydrateSession(payload as unknown as Parameters<HydrateSessionFn>[0]);

    expect(mockSetLocalStorageSession).toHaveBeenCalledWith(payload.session);
    expect(fresh._isReconciliationPending()).toBe(false);
  });

  test('reconcileSession re-authenticates via callMethod and updates localStorage', async () => {
    mockGetLocalStorageSession.mockReturnValue({ authToken: 'real-localstorage-token' });

    const fresh = await import('./session');
    fresh.hydrateSession({
      configs: [],
      session: { authToken: 'fresh-anonymous-ssr-token' },
      user: null,
    } as unknown as Parameters<HydrateSessionFn>[0]);

    expect(fresh._isReconciliationPending()).toBe(true);

    mockCallMethod.mockResolvedValueOnce({
      configs: [{ key: 'k', value: 'v' }],
      session: { authToken: 'real-localstorage-token' },
      user: { id: '7', handle: 'reconciled', roles: ['admin'] },
    } as never);

    await fresh.reconcileSession();

    expect(mockCallMethod).toHaveBeenCalledWith('_system.session.init');
    expect(mockSetLocalStorageSession).toHaveBeenCalledWith({
      authToken: 'real-localstorage-token',
    });
    expect(fresh.useSessionStore.getState().user?.id).toBe('7');
    expect(fresh._isReconciliationPending()).toBe(false);
  });

  test('reconcileSession is a no-op when no reconciliation is pending', async () => {
    const fresh = await import('./session');
    fresh.hydrateSession({
      configs: [],
      session: { authToken: 'abc' },
      user: { id: '1', handle: 'u', roles: [] },
    } as unknown as Parameters<HydrateSessionFn>[0]);

    await fresh.reconcileSession();
    expect(mockCallMethod).not.toHaveBeenCalled();
  });
});
