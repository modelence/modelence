import elasticApm from 'elastic-apm-node';
import winston from 'winston';
import { ElasticsearchTransport } from 'winston-elasticsearch';

import { getConfig } from '../config/server';
import { startLoggerProcess } from './loggerProcess';
import {
  getAppAlias,
  getEnvironmentAlias,
  getEnvironmentId,
  getTelemetryServiceName,
  isTelemetryEnabled,
} from './state';

let isInitialized = false;
let apm: typeof elasticApm | null = null;
let logger: winston.Logger | null = null;

export const initMetrics = async () => {
  if (isInitialized) {
    throw new Error('Metrics are already initialized, duplicate "initMetrics" call received');
  }

  isInitialized = true;

  if (isTelemetryEnabled()) {
    await initElasticApm();
  }
};

async function initElasticApm() {
  const elasticApmEndpoint = getConfig('_system.elastic.apmEndpoint') as string;
  const elasticCloudId = getConfig('_system.elastic.cloudId') as string;
  const elasticApiKey = getConfig('_system.elastic.apiKey') as string;

  const appAlias = getAppAlias() ?? 'unknown';
  const environmentAlias = getEnvironmentAlias() ?? 'unknown';
  const environmentId = getEnvironmentId() ?? 'unknown';
  const serviceName = getTelemetryServiceName();

  apm = elasticApm.start({
    serviceName,
    apiKey: elasticApiKey,
    serverUrl: elasticApmEndpoint,
    // environment: 'dev',
    transactionSampleRate: 1.0,
    centralConfig: false,
    globalLabels: {
      modelenceEnv: 'dev',
      appEnv: 'dev',
      environmentId,
      appAlias,
      environmentAlias,
    },
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
        apiKey: elasticApiKey,
      },
      requestTimeout: 10000,
      tls: {
        rejectUnauthorized: false,
      },
    },
    bufferLimit: 1000,
    silent: false,
  });

  esTransport.on('error', (error) => {
    console.error('Elasticsearch Transport Error:', error);
  });

  logger = winston.createLogger({
    level: 'debug',
    defaultMeta: {
      serviceName,
    },
    format: winston.format.combine(winston.format.json()),
    transports: [
      // new winston.transports.Console(), // TODO: remove, just for debugging
      esTransport,
    ],
  });

  startLoggerProcess({
    elasticCloudId,
    elasticApiKey,
  });
}

export function getApm() {
  if (!apm) {
    throw new Error('APM is not initialized');
  }
  return apm;
}

export function getLogger() {
  if (!logger) {
    throw new Error('Logger is not initialized');
  }
  return logger;
}
