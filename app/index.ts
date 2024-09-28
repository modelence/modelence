import dotenv from 'dotenv';
import os from 'os';

import { startServer } from './server';
import { initModules } from './initModules';
import { dataSources } from '../data/dataSources';
import { initDb } from '../db';
import { ConfigSchema } from '../config';
import { loadConfigs, setSchema } from '../config/server';

export async function startApp({ configSchema }: { configSchema?: ConfigSchema } = {}) {
  dotenv.config();

  await initModules();
  
  setSchema(configSchema ?? {});
  const { mongodbUri, configs } = await connectCloudBackend({ configSchema });
  loadConfigs(configs);

  await initDb(mongodbUri);
  await startServer();
}

async function connectCloudBackend({ configSchema }: { configSchema?: ConfigSchema }) {
  const { MODELENCE_SERVICE_ENDPOINT, MODELENCE_SERVICE_TOKEN } = process.env;
  
  if (!MODELENCE_SERVICE_ENDPOINT) {
    throw new Error('Unable to connect to Modelence backend: MODELENCE_SERVICE_ENDPOINT is not set');
  }

  try {
    const dataModels = Object.values(dataSources).map(({ ModelClass, schema, collectionName }) => {
      return {
        name: ModelClass.name,
        schema,
        collections: [collectionName]
      };
    });

    const response = await fetch(`${MODELENCE_SERVICE_ENDPOINT}/api/connect`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${MODELENCE_SERVICE_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        hostname: os.hostname(),
        dataModels,
        configSchema
      })
    });

    if (!response.ok) {
      throw new Error(`Unable to connect to Modelence backend: HTTP status: ${response.status}`);
    }

    const data = await response.json();
    console.log('Successfully connected to Modelence backend');
    return data;
  } catch (error) {
    console.error('Unable to connect to Modelence backend:', error);
    throw error;
  }
}
