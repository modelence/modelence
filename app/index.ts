import dotenv from 'dotenv';

import { startServer } from './server';
import { initModules } from './initModules';
import { initDb } from '../db';
import { ConfigSchema } from '../config';
import { loadConfigs, setSchema } from '../config/server';
import { startConfigSync } from '../config/sync';
import { connectCloudBackend } from './backendApi';

export async function startApp({ configSchema }: { configSchema?: ConfigSchema } = {}) {
  dotenv.config();

  await initModules();
  
  setSchema(configSchema ?? {});
  const { mongodbUri, configs } = await connectCloudBackend({ configSchema });
  loadConfigs(configs);

  await initDb(mongodbUri);
  await startConfigSync();

  await startServer();
}
