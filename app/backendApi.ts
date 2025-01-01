import os from 'os';
import { ConfigSchema } from '../config/types';
import { CronJobMetadata } from '../cron/types';
import { Store } from '../data/store';

export async function connectCloudBackend(
  { configSchema, cronJobsMetadata, stores }: { 
    configSchema?: ConfigSchema, 
    cronJobsMetadata?: CronJobMetadata[], 
    stores: Store<any, any>[] 
  }
) {
  const containerId = process.env.MODELENCE_CONTAINER_ID;
  if (!containerId) {
    throw new Error('Unable to connect to Modelence Cloud: MODELENCE_CONTAINER_ID is not set');
  }

  try {
    const dataModels = Object.values(stores).map(store => {
      return {
        name: store.getName(),
        schema: store.getSchema(),
        collections: [store.getName()]
      };
    });

    const data = await callApi('/api/connect', 'POST', {
      hostname: os.hostname(),
      containerId,
      dataModels,
      configSchema,
      cronJobsMetadata,
    });

    console.log('Successfully connected to Modelence Cloud');

    return data;
  } catch (error) {
    console.error('Unable to connect to Modelence Cloud:', error);
    throw error;
  }
}

export async function fetchConfigs() {
  const data = await callApi('/api/configs', 'GET');
  return data;
}

export async function syncStatus() {
  const data = await callApi('/api/sync', 'POST', {
    containerId: process.env.MODELENCE_CONTAINER_ID
  });
  return data;
}

async function callApi(endpoint: string, method: string, payload?: object) {
  const { MODELENCE_SERVICE_ENDPOINT, MODELENCE_SERVICE_TOKEN } = process.env;

  if (!MODELENCE_SERVICE_ENDPOINT) {
    throw new Error('Unable to connect to Modelence Cloud: MODELENCE_SERVICE_ENDPOINT is not set');
  }

  const response = await fetch(`${MODELENCE_SERVICE_ENDPOINT}/${endpoint}`, {
    method,
    headers: {
      'Authorization': `Bearer ${MODELENCE_SERVICE_TOKEN}`,
      ...(payload ? { 'Content-Type': 'application/json' } : {})
    },
    body: payload ? JSON.stringify(payload) : undefined
  });

  if (!response.ok) {
    const data = await response.json();
    throw new Error(`Unable to connect to Modelence Cloud: HTTP status: ${response.status}, ${data?.error}`);
  }

  return await response.json();
}
