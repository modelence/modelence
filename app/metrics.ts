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
