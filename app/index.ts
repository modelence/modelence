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
  console.log('Hostname:', os.hostname());
}
