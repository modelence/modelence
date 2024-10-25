import elasticApm from 'elastic-apm-node';

import { getConfig } from '../config/server';

let isInitialized = false;
let apm: typeof elasticApm | null = null;

export const initMetrics = async () => {
  if (isInitialized) {
    throw new Error('Metrics are already initialized, duplicate "initMetrics" call received');
  }

  isInitialized = true;

  initElasticApm();
};

function initElasticApm() {
  const elasticServerUrl = getConfig('_system.elastic.serverUrl') as string;
  const elasticSecretToken = getConfig('_system.elastic.secretToken') as string;

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
