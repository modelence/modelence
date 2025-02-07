import elasticApm from 'elastic-apm-node';
import winston from 'winston';
import { ElasticsearchTransport } from 'winston-elasticsearch';

import { getConfig } from '../config/server';
import { startLoggerProcess } from './loggerProcess';

let isInitialized = false;
let apm: typeof elasticApm | null = null;
let logger: winston.Logger | null = null;

export const initMetrics = async () => {
  if (isInitialized) {
    throw new Error('Metrics are already initialized, duplicate "initMetrics" call received');
  }

  isInitialized = true;

  const isTelemetryEnabled = Boolean(process.env.MODELENCE_TELEMETRY_ENABLED);
  if (isTelemetryEnabled) {
    await initElasticApm();
  }
};

async function initElasticApm() {
  const elasticApmEndpoint = getConfig('_system.elastic.apmEndpoint') as string;
  const elasticSecretToken = getConfig('_system.elastic.secretToken') as string;
  const elasticCloudId = getConfig('_system.elastic.cloudId') as string;
  const elasticApiKey = getConfig('_system.elastic.apiKey') as string;

  apm = elasticApm.start({
    serviceName: 'typesonic',
    secretToken: elasticSecretToken,
    serverUrl: elasticApmEndpoint,
    environment: 'dev',
    transactionSampleRate: 1.0,
    centralConfig: false,
    // logLevel: 'debug'
  });

  const esTransport = new ElasticsearchTransport({
    apm,
    level: 'debug',
    clientOpts: {
      cloud: {
        id: elasticCloudId,
      },
      auth: {
        apiKey: elasticApiKey
      },
      requestTimeout: 10000,
      tls: {
        rejectUnauthorized: false
      }
    },
    bufferLimit: 1000,
    silent: false,
  });

  esTransport.on('error', (error) => {
    console.error('Elasticsearch Transport Error:', error);
  });

  logger = winston.createLogger({
    level: 'debug',
    format: winston.format.combine(
      winston.format.json(),
    ),
    transports: [
      // new winston.transports.Console(), // TODO: remove, just for debugging
      esTransport
    ]
  });

  startLoggerProcess({
    elasticCloudId,
    elasticApiKey
  });
}

export function startTransaction(type: 'method' | 'cron', name: string, context?: Record<string, any>) {
  const isTelemetryEnabled = Boolean(process.env.MODELENCE_TELEMETRY_ENABLED);

  if (!isTelemetryEnabled) {
    return {
      end: () => {
        // do nothing
      }
    };
  }

  if (!apm) {
    throw new Error('startTransaction: Elastic APM is not initialized');
  }

  const transaction = apm.startTransaction(name, type);
  if (context) {
    apm.setCustomContext(context);
  }
  return transaction;
}

export function captureError(error: Error) {
  if (!apm) {
    throw new Error('captureError: Elastic APM is not initialized');
  }

  apm.captureError(error);
}

export function getLogger() {
  if (!logger) {
    throw new Error('Logger is not initialized');
  }
  return logger;
}
