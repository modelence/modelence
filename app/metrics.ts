import { NodeSDK } from '@opentelemetry/sdk-node';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { Resource } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
// import { diag, DiagLogLevel, DiagConsoleLogger } from '@opentelemetry/api';
import { createPrometheusExporter } from './metrics/prometheus';
import { initCallMetrics } from './metrics/callMetrics';

let isInitialized = false;

export const initMetrics = async ({ ampEndpoint, ampAccessKey, ampSecret, region }: 
  { ampEndpoint: string, ampAccessKey: string, ampSecret: string, region: string }) => {
  if (isInitialized) {
    throw new Error('Metrics are already initialized, duplicate "initMetrics" call received');
  }

  isInitialized = true;

  const sdk = new NodeSDK({
    resource: new Resource({
      [ATTR_SERVICE_NAME]: 'modelence-app',
      [ATTR_SERVICE_VERSION]: '1.0',
    }),
    metricReader: new PeriodicExportingMetricReader({
      exporter: createPrometheusExporter({ ampEndpoint, ampAccessKey, ampSecret, region }),
      exportIntervalMillis: 10000,
    }),
    instrumentations: [],
  });

  // diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.DEBUG);

  sdk.start();

  initCallMetrics();
};
