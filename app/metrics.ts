import { NodeSDK } from '@opentelemetry/sdk-node';
import { PeriodicExportingMetricReader, ConsoleMetricExporter } from '@opentelemetry/sdk-metrics';
import { Resource } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { Attributes, Counter, metrics } from '@opentelemetry/api';

// const exporter = new PrometheusExporter({ port: 9464 });

const sdk = new NodeSDK({
  resource: new Resource({
    [ATTR_SERVICE_NAME]: 'modelence-app',
    [ATTR_SERVICE_VERSION]: '1.0',
  }),
  // traceExporter: new ConsoleSpanExporter(),
  metricReader: new PeriodicExportingMetricReader({
    exporter: new ConsoleMetricExporter(),
    exportIntervalMillis: 5000,
  }),
  instrumentations: [],
});

const loaderMetrics = {
  callCounter: null as Counter<Attributes> | null,
};

export const initMetrics = () => {
  sdk.start();

  const loaderMeter = metrics.getMeter('loader');
  loaderMetrics.callCounter = loaderMeter.createCounter('loaderCalls', {
    description: 'The number of times the loader was invoked',
  });  
};

export const recordLoaderCall = ({ name }: { name: string }) => {
  loaderMetrics.callCounter?.add(1, { name });
};