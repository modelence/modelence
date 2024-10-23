import { NodeSDK } from '@opentelemetry/sdk-node';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { Resource } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
// import { diag, DiagLogLevel, DiagConsoleLogger } from '@opentelemetry/api';
import { createPrometheusExporter } from './metrics/prometheus';
import { initCallMetrics } from './metrics/callMetrics';
import elasticApm from 'elastic-apm-node';

let isInitialized = false;
let apm: typeof elasticApm | null = null;

export const initMetrics = async ({ elasticServerUrl, elasticSecretToken }: 
  { elasticServerUrl: string, elasticSecretToken: string }) => {
  if (isInitialized) {
    throw new Error('Metrics are already initialized, duplicate "initMetrics" call received');
  }

  isInitialized = true;

  initElasticApm({ elasticServerUrl, elasticSecretToken });

  // const sdk = new NodeSDK({
  //   resource: new Resource({
  //     [ATTR_SERVICE_NAME]: 'modelence-app',
  //     [ATTR_SERVICE_VERSION]: '1.0',
  //   }),
  //   metricReader: new PeriodicExportingMetricReader({
  //     exporter: createPrometheusExporter({ ampEndpoint, ampAccessKey, ampSecret, region }),
  //     exportIntervalMillis: 10000,
  //   }),
  //   instrumentations: [],
  // });

  // sdk.start();

  // initCallMetrics();
};

function initElasticApm({ elasticServerUrl, elasticSecretToken }: { elasticServerUrl: string, elasticSecretToken: string }) {
  apm = elasticApm.start({
    serviceName: 'typesonic',
    secretToken: elasticSecretToken,
    serverUrl: elasticServerUrl,
    environment: 'dev'
  });
}

export function startLoaderTransaction(loaderName: string, args: any[]) {
  if (!apm) {
    throw new Error('Elastic APM is not initialized');
  }

  const transaction = apm.startTransaction(`loader:${loaderName}`, 'loader');
  apm.setCustomContext({ args });
  return transaction;
}
