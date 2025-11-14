import { beforeEach, describe, expect, jest, test } from '@jest/globals';

const mockSeconds = jest.fn(() => 5000);
const mockSyncStatus = jest.fn();
const mockFetchConfigs = jest.fn();
const mockLoadConfigs = jest.fn();
const mockAcquireLock = jest.fn();

jest.unstable_mockModule('../time', () => ({
  time: {
    seconds: mockSeconds,
  },
}));

jest.unstable_mockModule('../app/backendApi', () => ({
  syncStatus: mockSyncStatus,
  fetchConfigs: mockFetchConfigs,
}));

jest.unstable_mockModule('./server', () => ({
  loadConfigs: mockLoadConfigs,
}));

describe('config/sync', () => {
  let intervalCallback: (() => Promise<void>) | null = null;
  let intervalDelay: number | undefined;
  let startConfigSync: typeof import('./sync').startConfigSync;
  const originalSetInterval = global.setInterval;

  beforeEach(async () => {
    jest.clearAllMocks();
    intervalCallback = null;
    intervalDelay = undefined;
    global.setInterval = (((handler: TimerHandler, timeout?: number) => {
      intervalCallback = handler as () => Promise<void>;
      intervalDelay = timeout;
      return 1 as unknown as NodeJS.Timeout;
    }) as unknown) as typeof setInterval;
    mockAcquireLock.mockResolvedValue(true as never);
    mockSyncStatus.mockResolvedValue(undefined as never);
    ({ startConfigSync } = await import('./sync'));
  });

  afterEach(() => {
    global.setInterval = originalSetInterval;
  });

  test('startConfigSync schedules interval and performs sync steps', async () => {
    mockFetchConfigs.mockResolvedValue({ configs: [{ key: 'demo', type: 'string', value: 'v' }] } as never);
    await startConfigSync();

    expect(intervalDelay).toBe(5000);
    expect(intervalCallback).toBeTruthy();

    await intervalCallback?.();

    expect(mockSyncStatus).toHaveBeenCalled();
    expect(mockFetchConfigs).toHaveBeenCalled();
    expect(mockLoadConfigs).toHaveBeenCalledWith([{ key: 'demo', type: 'string', value: 'v' }]);
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
    intervalCallback?.();
    expect(mockFetchConfigs).toHaveBeenCalledTimes(1);

    if (fetchResolve) {
      (fetchResolve as () => void)();
    }
    await firstRun;
  });
});
