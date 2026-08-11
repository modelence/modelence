import { describe, expect, test, vi } from 'vitest';

type SetupOptions = {
  telemetryEnabled?: boolean;
  configValues?: Record<string, string>;
  appAlias?: string;
  environmentAlias?: string;
  environmentId?: string;
  serviceName?: string;
};

async function setupMetrics(options: SetupOptions = {}) {
  vi.resetModules();

  const {
    telemetryEnabled = true,
    configValues = {
      '_system.elastic.apmEndpoint': 'https://apm.example.com',
      '_system.elastic.apiKey': 'api-key',
    },
    appAlias = 'app-alias',
    environmentAlias = 'env-alias',
    environmentId = 'env-id',
    serviceName = 'telemetry-service',
  } = options;

  const apmInstance = { name: 'apm' };

  const elasticStart = vi.fn().mockReturnValue(apmInstance);
  const getConfig = vi.fn((key: string) => configValues[key]);

  const stateMocks = {
    getAppAlias: vi.fn(() => appAlias),
    getEnvironmentAlias: vi.fn(() => environmentAlias),
    getEnvironmentId: vi.fn(() => environmentId),
    getTelemetryServiceName: vi.fn(() => serviceName),
    isTelemetryEnabled: vi.fn(() => telemetryEnabled),
  };

  vi.doMock('elastic-apm-node', () => ({
    default: {
      start: elasticStart,
    },
  }));

  vi.doMock('../config/server', () => ({
    getConfig,
  }));

  vi.doMock('./state', () => stateMocks);

  const metrics = await import('./metrics');

  return {
    metrics,
    mocks: {
      elasticStart,
      getConfig,
      state: stateMocks,
      apmInstance,
      configValues,
      serviceName,
      environmentAlias,
      environmentId,
      appAlias,
    },
  };
}

describe('app/metrics', () => {
  test('getApm throws when initialization never happened', async () => {
    const { metrics } = await setupMetrics();
    expect(() => metrics.getApm()).toThrow('APM is not initialized');
  });

  test('initMetrics skips telemetry setup when disabled', async () => {
    const { metrics, mocks } = await setupMetrics({ telemetryEnabled: false });

    await metrics.initMetrics();

    expect(mocks.elasticStart).not.toHaveBeenCalled();
    expect(() => metrics.getApm()).toThrow('APM is not initialized');
  });

  test('initMetrics throws on duplicate initialization', async () => {
    const { metrics } = await setupMetrics({ telemetryEnabled: false });

    await metrics.initMetrics();

    await expect(metrics.initMetrics()).rejects.toThrow(
      'Metrics are already initialized, duplicate "initMetrics" call received'
    );
  });

  test('initMetrics configures Elastic APM when telemetry enabled', async () => {
    const configValues = {
      '_system.elastic.apmEndpoint': 'https://apm.service.test',
      '_system.elastic.apiKey': 'elastic-key',
    };

    const { metrics, mocks } = await setupMetrics({
      telemetryEnabled: true,
      configValues,
      appAlias: 'my-app',
      environmentAlias: 'staging',
      environmentId: 'env-123',
      serviceName: 'svc-api',
    });

    await metrics.initMetrics();

    expect(mocks.elasticStart).toHaveBeenCalledWith(
      expect.objectContaining({
        serviceName: 'svc-api',
        apiKey: 'elastic-key',
        serverUrl: 'https://apm.service.test',
        globalLabels: expect.objectContaining({
          environmentId: 'env-123',
          appAlias: 'my-app',
          environmentAlias: 'staging',
        }),
      })
    );

    expect(metrics.getApm()).toBe(mocks.apmInstance);
  });
});
