import { startServer } from './server';
import { initModules } from './initModules';
import os from 'os';

export async function startApp() {
  await initModules();
  await connectCloudBackend();
  await startServer();
}

async function connectCloudBackend() {
  console.log('Hostname:', os.hostname());
}
