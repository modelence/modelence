import elasticApm from 'elastic-apm-node';
import { Writable } from 'stream';
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

  await initElasticApm();
};

async function initElasticApm() {
  const elasticServerUrl = getConfig('_system.elastic.serverUrl') as string;
  const elasticSecretToken = getConfig('_system.elastic.secretToken') as string;

  // TODO: Move cloud.id to config: getConfig('_system.elastic.cloudId') as string;
  const elasticCloudId = 'Modelence:dXMtd2VzdC0yLmF3cy5mb3VuZC5pbzo0NDMkNzdmYWU4ZDMwMzQ2NDZlMTg2ODYwYjIyYmY1MTc0OGIkNTFlZTMwNmI4YzVhNDVjYWI4NjVmNzA5ZmIyZTdiZDI=';
  const elasticApiKey = getConfig('_system.elastic.apiKey') as string;

  apm = elasticApm.start({
    serviceName: 'typesonic',
    secretToken: elasticSecretToken,
    serverUrl: elasticServerUrl,
    environment: 'dev',
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

export function startLoaderTransaction(loaderName: string, args: any[]) {
  if (!apm) {
    throw new Error('Elastic APM is not initialized');
  }

  const transaction = apm.startTransaction(`loader:${loaderName}`, 'loader');
  apm.setCustomContext({ args });
  return transaction;
}

export function getLogger() {
  if (!logger) {
    throw new Error('Logger is not initialized');
  }
  return logger;
}
