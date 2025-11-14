import { describe, expect, jest, test } from '@jest/globals';

type SetupOptions = {
  telemetryEnabled?: boolean;
  configValues?: Record<string, string>;
  appAlias?: string;
  environmentAlias?: string;
  environmentId?: string;
  serviceName?: string;
};

async function setupMetrics(options: SetupOptions = {}) {
  jest.resetModules();

  const {
    telemetryEnabled = true,
    configValues = {
      '_system.elastic.apmEndpoint': 'https://apm.example.com',
      '_system.elastic.cloudId': 'cloud-id',
      '_system.elastic.apiKey': 'api-key',
    },
    appAlias = 'app-alias',
    environmentAlias = 'env-alias',
    environmentId = 'env-id',
    serviceName = 'telemetry-service',
  } = options;

  const apmInstance = { name: 'apm' };
  const loggerInstance = { log: jest.fn() };

  const elasticStart = jest.fn().mockReturnValue(apmInstance);
  const createLogger = jest.fn().mockReturnValue(loggerInstance);
  const formatCombine = jest.fn(() => 'combined-format');
  const formatJson = jest.fn(() => 'json-format');
  const startLoggerProcess = jest.fn();
  const getConfig = jest.fn((key: string) => configValues[key]);

  const stateMocks = {
    getAppAlias: jest.fn(() => appAlias),
    getEnvironmentAlias: jest.fn(() => environmentAlias),
    getEnvironmentId: jest.fn(() => environmentId),
    getTelemetryServiceName: jest.fn(() => serviceName),
    isTelemetryEnabled: jest.fn(() => telemetryEnabled),
  };

  type TransportInstance = { options: unknown; on: jest.Mock };
  const transportInstances: TransportInstance[] = [];

  class MockElasticsearchTransport {
    options: unknown;
    on: jest.Mock;
    constructor(opts: unknown) {
      this.options = opts;
      this.on = jest.fn();
      transportInstances.push(this);
    }
  }

  jest.unstable_mockModule('elastic-apm-node', () => ({
    default: {
      start: elasticStart,
    },
  }));

  jest.unstable_mockModule('winston', () => ({
    default: {
      createLogger,
      format: {
        combine: formatCombine,
        json: formatJson,
      },
    },
  }));

  jest.unstable_mockModule('winston-elasticsearch', () => ({
    ElasticsearchTransport: MockElasticsearchTransport,
  }));

  jest.unstable_mockModule('../config/server', () => ({
    getConfig,
  }));

  jest.unstable_mockModule('./loggerProcess', () => ({
    startLoggerProcess,
  }));

  jest.unstable_mockModule('./state', () => stateMocks);

  const metrics = await import('./metrics');

  return {
    metrics,
    mocks: {
      elasticStart,
      createLogger,
      formatCombine,
      formatJson,
      startLoggerProcess,
      getConfig,
      state: stateMocks,
      transportInstances,
      apmInstance,
      loggerInstance,
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

  test('getLogger throws when initialization never happened', async () => {
    const { metrics } = await setupMetrics();
    expect(() => metrics.getLogger()).toThrow('Logger is not initialized');
  });

  test('initMetrics skips telemetry setup when disabled', async () => {
    const { metrics, mocks } = await setupMetrics({ telemetryEnabled: false });

    await metrics.initMetrics();

    expect(mocks.elasticStart).not.toHaveBeenCalled();
    expect(mocks.createLogger).not.toHaveBeenCalled();
    expect(mocks.startLoggerProcess).not.toHaveBeenCalled();
    expect(() => metrics.getApm()).toThrow('APM is not initialized');
    expect(() => metrics.getLogger()).toThrow('Logger is not initialized');
  });

  test('initMetrics throws on duplicate initialization', async () => {
    const { metrics } = await setupMetrics({ telemetryEnabled: false });

    await metrics.initMetrics();

    await expect(metrics.initMetrics()).rejects.toThrow(
      'Metrics are already initialized, duplicate "initMetrics" call received'
    );
  });

  test('initMetrics configures Elastic APM, logger, and logger process when telemetry enabled', async () => {
    const configValues = {
      '_system.elastic.apmEndpoint': 'https://apm.service.test',
      '_system.elastic.cloudId': 'elastic-cloud',
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

    expect(mocks.transportInstances).toHaveLength(1);
    const transportInstance = mocks.transportInstances[0];
    expect(transportInstance?.options).toMatchObject({
      apm: mocks.apmInstance,
      level: 'debug',
      clientOpts: {
        cloud: { id: 'elastic-cloud' },
        auth: { apiKey: 'elastic-key' },
      },
    });

    expect(mocks.createLogger).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'debug',
        defaultMeta: { serviceName: 'svc-api' },
        transports: [transportInstance],
      })
    );

    expect(mocks.startLoggerProcess).toHaveBeenCalledWith({
      elasticCloudId: 'elastic-cloud',
      elasticApiKey: 'elastic-key',
    });

    expect(metrics.getApm()).toBe(mocks.apmInstance);
    expect(metrics.getLogger()).toBe(mocks.loggerInstance);
  });
});
