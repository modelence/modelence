import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import protobuf from 'protobufjs';
import snappy from 'snappy';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { DataPoint, PeriodicExportingMetricReader, ResourceMetrics, ScopeMetrics, Histogram, ExponentialHistogram } from '@opentelemetry/sdk-metrics';
import { Resource } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { Counter, metrics, Attributes } from '@opentelemetry/api';
// import { diag, DiagLogLevel, DiagConsoleLogger } from '@opentelemetry/api';
import { createSignedFetcher } from 'aws-sigv4-fetch';
import prometheusProtoJson from './prometheusProto';
const loaderMetrics = {
  callCounter: null as Counter<Attributes> | null,
};

let isInitialized = false;

let signedFetch: typeof fetch | null = null;

// function loadProto(protoPath) {
//   return new Promise((resolve, reject) => {
//     protobuf.load(protoPath, (err, root) => {
//       if (err) {
//         reject(err);
//       } else {
//         resolve(root);
//       }
//     });
//   });
// }

const root = protobuf.Root.fromJSON(prometheusProtoJson);
const WriteRequest = root.lookupType('prometheus.WriteRequest');

export const initMetrics = async ({ ampEndpoint, ampAccessKey, ampSecret, region }: 
  { ampEndpoint: string, ampAccessKey: string, ampSecret: string, region: string }) => {
  console.log('initMetrics', ampEndpoint);
  if (isInitialized) {
    throw new Error('Metrics are already initialized, duplicate "initMetrics" call received');
  }

  isInitialized = true;

  signedFetch = createSignedFetcher({
    service: 'aps',
    region,
    credentials: { accessKeyId: ampAccessKey, secretAccessKey: ampSecret },
  });

  const customMetricExporter = new OTLPMetricExporter({
    url: ampEndpoint,
    headers: {}  // Will be added after signing
  });

  // Override the `export` method to include signed requests
  customMetricExporter.export = async (resourceMetrics: ResourceMetrics, resultCallback) => {
    if (!signedFetch) {
      throw new Error('signedFetch is not initialized');
    }

    // console.log('customMetricExporter.export', metrics);
    console.log('scopeMetrics', JSON.stringify(resourceMetrics.scopeMetrics));

    try {
      const data = convertToPrometheusFormat(resourceMetrics.scopeMetrics);
      console.log('data', data);

      const err = WriteRequest.verify(data);
      if (err) throw Error(err);

      const message = WriteRequest.create(data);
      const buffer = WriteRequest.encode(message).finish();
      
      // Compress the buffer using Snappy
      const compressedBuffer = await snappy.compress(Buffer.from(buffer));
      
      const response = await signedFetch(ampEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-protobuf',
          'Content-Encoding': 'snappy'
        },
        body: compressedBuffer,
      });

      if (response.ok) {
        resultCallback({ code: 0 });  // ExportResult.SUCCESS
      } else {
        console.error('Failed to export metrics', response);
        resultCallback({ code: 1 });  // ExportResult.FAILED
      }
    } catch (error) {
      resultCallback({ code: 1, error });
    }
  };

  const sdk = new NodeSDK({
    resource: new Resource({
      [ATTR_SERVICE_NAME]: 'modelence-app',
      [ATTR_SERVICE_VERSION]: '1.0',
    }),
    metricReader: new PeriodicExportingMetricReader({
      exporter: customMetricExporter,
      exportIntervalMillis: 10000,
    }),
    instrumentations: [],
  });

  // diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.DEBUG);

  sdk.start();

  const loaderMeter = metrics.getMeter('loader');
  loaderMetrics.callCounter = loaderMeter.createCounter('loaderCalls', {
    description: 'The number of times the loader was invoked',
  });  
};

function convertToPrometheusFormat(scopedMetrics: ScopeMetrics[]) {
  const timeseries = [];

  scopedMetrics.forEach(({ metrics, scope }) => {
    metrics.forEach(({ descriptor, dataPoints }) => {
      const metricName = descriptor.name;

      dataPoints.forEach((dataPoint: DataPoint<number> | DataPoint<Histogram> | DataPoint<ExponentialHistogram>) => {
        const labels = Object.keys(dataPoint.attributes).map(key => ({
          name: key,
          value: dataPoint.attributes[key]
        }));

        labels.push({ name: '__name__', value: metricName });

        const samples = [
          {
            value: dataPoint.value,
            timestamp: Math.floor(dataPoint.endTime[0] * 1000 + dataPoint.endTime[1] / 1000000) // Convert to milliseconds
          }
        ];

        timeseries.push({ labels, samples });
      });
    });
  });

  return { timeseries };
}

export const recordLoaderCall = ({ name }: { name: string }) => {
  loaderMetrics.callCounter?.add(1, { name });
};
