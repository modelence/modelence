import dotenv from 'dotenv';

import { startServer } from './server';
import { initModules } from './initModules';
import { initDb } from '../db';
import { ConfigSchema } from '../config';
import { loadConfigs, setSchema } from '../config/server';
import { startConfigSync } from '../config/sync';
import { connectCloudBackend } from './backendApi';
import { initMetrics } from './metrics';
import { createStsClient } from './aws';

export async function startApp({ configSchema }: { configSchema?: ConfigSchema } = {}) {
  dotenv.config();

  await initModules();
  
  setSchema(configSchema ?? {});
  const { mongodbUri, ampEndpoint, ampAccessKey, ampSecret, configs } = await connectCloudBackend({ configSchema });
  loadConfigs(configs);

  await initDb(mongodbUri);
  const stsClient = await createStsClient({ accessKey: ampAccessKey, secret: ampSecret });
  await initMetrics({ ampEndpoint, stsClient });
  await startConfigSync();

  await startServer();
}
