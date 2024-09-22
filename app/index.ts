import dotenv from 'dotenv';
import os from 'os';

import { startServer } from './server';
import { initModules } from './initModules';
import { dataSources } from '../data/dataSources';
import { initDb } from '../db';

export async function startApp() {
  dotenv.config();

  await initModules();
  const appConfig = await connectCloudBackend();
  await initDb(appConfig.mongodbUri);
  await startServer();
}

async function connectCloudBackend() {
  const { MODELENCE_SERVICE_ENDPOINT, MODELENCE_SERVICE_TOKEN } = process.env;
  
  if (!MODELENCE_SERVICE_ENDPOINT) {
    throw new Error('Unable to connect to Modelence backend: MODELENCE_SERVICE_ENDPOINT is not set');
  }

  try {
    const dataModels = Object.values(dataSources).map(({ ModelClass, schema }) => {
      return {
        name: ModelClass.name,
        schema
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
        dataModels
      })
    });

    if (!response.ok) {
      throw new Error(`Unable to connect to Modelence backend: HTTP status: ${response.status}`);
    }

    const data = await response.json();
    console.log('Successfully connected to Modelence backend:', data);
    return data;
  } catch (error) {
    console.error('Unable to connect to Modelence backend:', error);
    throw error;
  }
}
