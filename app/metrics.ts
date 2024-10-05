import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { Resource } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { Counter, metrics, Attributes } from '@opentelemetry/api';
import { diag, DiagLogLevel, DiagConsoleLogger } from '@opentelemetry/api';
import { STSClient } from '@aws-sdk/client-sts';

const loaderMetrics = {
  callCounter: null as Counter<Attributes> | null,
};

let isInitialized = false;

export const initMetrics = ({ ampEndpoint, stsClient }: { ampEndpoint: string, stsClient: STSClient }) => {
  console.log('initMetrics', ampEndpoint);
  if (isInitialized) {
    throw new Error('Metrics are already initialized, duplicate "initMetrics" call received');
  }

  isInitialized = true;

  const ampExporter = new OTLPMetricExporter({
    url: ampEndpoint,
    headers: {
      'X-Prometheus-Remote-Write-Version': '0.1.0',
    },
    concurrencyLimit: 10,
  });
  
  const sdk = new NodeSDK({
    resource: new Resource({
      [ATTR_SERVICE_NAME]: 'modelence-app',
      [ATTR_SERVICE_VERSION]: '1.0',
    }),
    // traceExporter: new ConsoleSpanExporter(),
    metricReader: new PeriodicExportingMetricReader({
      exporter: ampExporter,
      exportIntervalMillis: 10000,
    }),
    instrumentations: [],
  });

  diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.DEBUG);

  sdk.start();

  const loaderMeter = metrics.getMeter('loader');
  loaderMetrics.callCounter = loaderMeter.createCounter('loaderCalls', {
    description: 'The number of times the loader was invoked',
  });  
};

export const recordLoaderCall = ({ name }: { name: string }) => {
  loaderMetrics.callCounter?.add(1, { name });
};
