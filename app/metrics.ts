import elasticApm from 'elastic-apm-node';
import { Writable } from 'stream';
import winston from 'winston';
import { ElasticsearchTransport } from 'winston-elasticsearch';

import { getConfig } from '../config/server';

let isInitialized = false;
let apm: typeof elasticApm | null = null;
let logger: winston.Logger | null = null;

export const initMetrics = async () => {
  if (isInitialized) {
    throw new Error('Metrics are already initialized, duplicate "initMetrics" call received');
  }

  isInitialized = true;

  await initElasticApm();

  // process.stdout.pipe(createLoggingStream(process.stdout));
  // process.stderr.pipe(createLoggingStream(process.stderr));
};

async function initElasticApm() {
  const elasticServerUrl = getConfig('_system.elastic.serverUrl') as string;
  const elasticSecretToken = getConfig('_system.elastic.secretToken') as string;
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
        id: 'Modelence:dXMtd2VzdC0yLmF3cy5mb3VuZC5pbzo0NDMkNzdmYWU4ZDMwMzQ2NDZlMTg2ODYwYjIyYmY1MTc0OGIkNTFlZTMwNmI4YzVhNDVjYWI4NjVmNzA5ZmIyZTdiZDI='
      },
      auth: {
        apiKey: elasticApiKey
      },
      requestTimeout: 10000,
      tls: {
        rejectUnauthorized: false
      }
    },
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
      new winston.transports.Console(),
      esTransport
    ]
  });
}

function createLoggingStream(originalStream: NodeJS.WriteStream | NodeJS.WritableStream) {
  return new Writable({
    write(chunk, encoding, callback) {
      originalStream.write(chunk);

      const message = chunk.toString();

      log(message, {
        source: 'console',
      }, 'info');
      
      callback();
    }
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

export function log(
  message: string,
  args: object,
  level: 'trace' | 'debug' | 'info' | 'warn' | 'error' = 'info',
) {
  if (!logger) {
    throw new Error('Logger is not initialized');
  }
  logger.info(message, args);
}
