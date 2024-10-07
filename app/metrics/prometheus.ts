import protobuf from 'protobufjs';
import snappy from 'snappy';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { DataPoint, ResourceMetrics, ScopeMetrics, Histogram, ExponentialHistogram } from '@opentelemetry/sdk-metrics';
import { AttributeValue } from '@opentelemetry/api';
import prometheusProtoJson from './prometheusProto';
import { createSignedFetcher } from 'aws-sigv4-fetch';

const root = protobuf.Root.fromJSON(prometheusProtoJson);
const WriteRequest = root.lookupType('prometheus.WriteRequest');

export function createPrometheusExporter({ ampEndpoint, ampAccessKey, ampSecret, region }: { ampEndpoint: string, ampAccessKey: string, ampSecret: string, region: string }) {
  const signedFetch = createSignedFetcher({
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

  // TODO: make this exportable
  /* no-await */queryMetrics(signedFetch, ampEndpoint, '{__name__=~"loader.*"}').then((response) => {
    const data = response.data;
    console.log('query data', JSON.stringify(data, null, 2));
  });

  return customMetricExporter;
}

export async function queryMetrics(signedFetch: typeof fetch, ampEndpoint: string, query: string, time?: string, timeout?: string): Promise<any> {
  const params = new URLSearchParams({
    query,
    ...(time && { time }),
    ...(timeout && { timeout }),
  });

  const queryUrl = ampEndpoint.split('/').slice(0, -1).join('/') + `/query?${params.toString()}`;
  console.log('queryMetrics', queryUrl);

  try {
    const response = await signedFetch(queryUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const json = await response.json();
      throw new Error(`HTTP error! status: ${response.status} ${json.error}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Error querying metrics:', error);
    throw error;
  }
};

type TimeseriesLabel = { name: string; value: AttributeValue | undefined };
type TimeseriesSample = { value: number | Histogram | ExponentialHistogram; timestamp: number };
type TimeseriesRecord = { labels: TimeseriesLabel[]; samples: TimeseriesSample[] };

function convertToPrometheusFormat(scopedMetrics: ScopeMetrics[]) {
  const timeseries: TimeseriesRecord[] = [];

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