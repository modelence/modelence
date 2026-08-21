import elasticApm from 'elastic-apm-node';

import { getConfig } from '../config/server';
import {
  getAppAlias,
  getEnvironmentAlias,
  getEnvironmentId,
  getTelemetryServiceName,
  isTelemetryEnabled,
} from './state';

let isInitialized = false;
let apm: typeof elasticApm | null = null;

export const initMetrics = async () => {
  if (isInitialized) {
    throw new Error('Metrics are already initialized, duplicate "initMetrics" call received');
  }

  isInitialized = true;

  if (isTelemetryEnabled()) {
    initElasticApm();
  }
};

function initElasticApm() {
  const elasticApmEndpoint = getConfig('_system.elastic.apmEndpoint') as string;
  const elasticApiKey = getConfig('_system.elastic.apiKey') as string;

  const appAlias = getAppAlias() ?? 'unknown';
  const environmentAlias = getEnvironmentAlias() ?? 'unknown';
  const environmentId = getEnvironmentId() ?? 'unknown';
  const serviceName = getTelemetryServiceName();

  apm = elasticApm.start({
    serviceName,
    apiKey: elasticApiKey,
    serverUrl: elasticApmEndpoint,
    transactionSampleRate: 1.0,
    centralConfig: false,
    globalLabels: {
      modelenceEnv: 'dev',
      appEnv: 'dev',
      environmentId,
      appAlias,
      environmentAlias,
    },
  });
}

export function getApm() {
  if (!apm) {
    throw new Error('APM is not initialized');
  }
  return apm;
}
