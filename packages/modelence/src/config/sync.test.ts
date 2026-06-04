import { beforeEach, describe, expect, test, afterEach, vi } from 'vitest';

const mockSeconds = vi.fn(() => 5000);
const mockSyncStatus = vi.fn();
const mockFetchConfigs = vi.fn();
const mockLoadConfigs = vi.fn();
const mockGetSchema = vi.fn(() => ({}));
const mockGetLocalConfigs = vi.fn((_schema: unknown, _variant?: unknown) => []);
const mockAcquireLock = vi.fn();

vi.doMock('../time', () => ({
  time: {
    seconds: mockSeconds,
  },
}));

vi.doMock('../app/backendApi', () => ({
  syncStatus: mockSyncStatus,
  fetchConfigs: mockFetchConfigs,
}));

vi.doMock('./local', () => ({
  getLocalConfigs: mockGetLocalConfigs,
}));

vi.doMock('./server', () => ({
  loadConfigs: mockLoadConfigs,
  getSchema: mockGetSchema,
}));

describe('config/sync', () => {
  let intervalCallback: (() => Promise<void>) | null = null;
  let intervalDelay: number | undefined;
  let startConfigSync: typeof import('./sync').startConfigSync;
  let loadRemoteConfigs: typeof import('./sync').loadRemoteConfigs;
  const originalSetInterval = global.setInterval;

  beforeEach(async () => {
    vi.clearAllMocks();
    intervalCallback = null;
    intervalDelay = undefined;
    global.setInterval = ((handler: TimerHandler, timeout?: number) => {
      intervalCallback = handler as () => Promise<void>;
      intervalDelay = timeout;
      return 1 as unknown as NodeJS.Timeout;
    }) as unknown as typeof setInterval;
    mockAcquireLock.mockResolvedValue(true as never);
    mockSyncStatus.mockResolvedValue(undefined as never);
    ({ startConfigSync, loadRemoteConfigs } = await import('./sync'));
  });

  afterEach(() => {
    global.setInterval = originalSetInterval;
  });

  test('startConfigSync schedules interval and performs sync steps', async () => {
    mockFetchConfigs.mockResolvedValue({
      configs: [{ key: 'demo', type: 'string', value: 'v' }],
    } as never);
    await startConfigSync();

    expect(intervalDelay).toBe(5000);
    expect(intervalCallback).toBeTruthy();

    await intervalCallback?.();

    expect(mockSyncStatus).toHaveBeenCalled();
    expect(mockFetchConfigs).toHaveBeenCalled();
    expect(mockLoadConfigs).toHaveBeenNthCalledWith(1, [
      { key: 'demo', type: 'string', value: 'v' },
    ]);
    expect(mockLoadConfigs).toHaveBeenNthCalledWith(2, []);
    expect(mockGetLocalConfigs).toHaveBeenCalledWith(
      expect.objectContaining({}),
      'withRemoteServer'
    );
  });

  test('loadRemoteConfigs loads remote configs then local withRemoteServer overrides', async () => {
    const remoteConfigs = [
      { key: '_system.site.url', type: 'string', value: 'https://cloud.example.com' },
      { key: '_system.mongodbUri', type: 'string', value: 'mongodb://cloud:27017/app' },
    ];
    const localOverrides = [
      { key: '_system.site.url', type: 'string', value: 'https://local.example.com' },
    ];
    mockGetLocalConfigs.mockReturnValue(localOverrides as never);

    loadRemoteConfigs(remoteConfigs as never);

    expect(mockLoadConfigs).toHaveBeenNthCalledWith(1, remoteConfigs);
    expect(mockGetLocalConfigs).toHaveBeenCalledWith(expect.anything(), 'withRemoteServer');
    expect(mockLoadConfigs).toHaveBeenNthCalledWith(2, localOverrides);
  });

  test('avoids concurrent sync executions using isSyncing guard', async () => {
    let fetchResolve: (() => void) | null = null;
    const pendingPromise = new Promise<void>((resolve) => {
      fetchResolve = resolve;
    });
    mockFetchConfigs.mockReturnValue(pendingPromise.then(() => ({ configs: [] })) as never);
    await startConfigSync();
    expect(intervalCallback).toBeTruthy();
    const firstRun = intervalCallback?.();
    await Promise.resolve();
    void intervalCallback?.();
    expect(mockFetchConfigs).toHaveBeenCalledTimes(1);

    if (fetchResolve) {
      (fetchResolve as () => void)();
    }
    await firstRun;
  });
});
