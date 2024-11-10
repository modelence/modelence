import dotenv from 'dotenv';

import { startServer } from './server';
import { initModules } from './initModules';
import { initDb } from '../db';
import { ConfigSchema } from '../config';
import { loadConfigs, setSchema } from '../config/server';
import { startConfigSync } from '../config/sync';
import { connectCloudBackend } from './backendApi';
import { initMetrics } from './metrics';
import { markAppStarted } from './state';
import { startCronJobs, getCronJobsMetadata } from '../cron/jobs';
// import { createStsClient } from './aws';

export async function startApp({ configSchema }: { configSchema?: ConfigSchema } = {}) {
  markAppStarted();

  dotenv.config();

  await initModules();
  
  setSchema(configSchema ?? {});
  const { mongodbUri, configs } = await connectCloudBackend({
    configSchema,
    cronJobsMetadata: getCronJobsMetadata(),
  });
  loadConfigs(configs);

  await initDb(mongodbUri);
  await initMetrics();
  startConfigSync();

  if (Number(process.env.MODELENCE_CRON_INSTANCE)) {
    await startCronJobs();
  }

  await startServer();
}
