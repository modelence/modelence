import os from 'os';
import { dataSources } from '../data/dataSources';
import { ConfigSchema } from '../config';

export async function connectCloudBackend({ configSchema }: { configSchema?: ConfigSchema }) {
  try {
    const dataModels = Object.values(dataSources).map(({ ModelClass, schema, collectionName }) => {
      return {
        name: ModelClass.name,
        schema,
        collections: [collectionName]
      };
    });

    const data = await callApi('/api/connect', 'POST', {
      hostname: os.hostname(),
      dataModels,
      configSchema
    });

    console.log('Successfully connected to Modelence backend');

    return data;
  } catch (error) {
    console.error('Unable to connect to Modelence backend:', error);
    throw error;
  }
}

export async function fetchConfigs() {
  const data = await callApi('/api/configs', 'GET');
  return data;
}

async function callApi(endpoint: string, method: string, payload?: object) {
  const { MODELENCE_SERVICE_ENDPOINT, MODELENCE_SERVICE_TOKEN } = process.env;
  
  if (!MODELENCE_SERVICE_ENDPOINT) {
    throw new Error('Unable to connect to Modelence API: MODELENCE_SERVICE_ENDPOINT is not set');
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
    throw new Error(`Unable to connect to Modelence API: HTTP status: ${response.status}, ${data?.error}`);
  }

  return await response.json();
}
