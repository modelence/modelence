import dotenv from 'dotenv';
import os from 'os';

import { startServer } from './server';
import { initModules } from './initModules';

export async function startApp() {
  dotenv.config();

  await initModules();
  await connectCloudBackend();
  await startServer();
}

async function connectCloudBackend() {
  const { MODELENCE_SERVICE_ENDPOINT, MODELENCE_SERVICE_TOKEN } = process.env;
  
  if (!MODELENCE_SERVICE_ENDPOINT) {
    throw new Error('Unable to connect to Modelence backend: MODELENCE_SERVICE_ENDPOINT is not set');
  }

  try {
    const response = await fetch(`${MODELENCE_SERVICE_ENDPOINT}/api/connect`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${MODELENCE_SERVICE_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        hostname: os.hostname()
      })
    });

    if (!response.ok) {
      throw new Error(`Unable to connect to Modelence backend: HTTP status: ${response.status}`);
    }

    const data = await response.json();
    console.log('Successfully connected to Modelence backend:', data);
  } catch (error) {
    console.error('Unable to connect to Modelence backend:', error);
    throw error;
  }
}
