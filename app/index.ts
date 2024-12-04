import dotenv from 'dotenv';

import { startServer } from './server';
import { connect, getClient } from '../db/client';
import { ConfigSchema } from '../config/types';
import { loadConfigs, setSchema } from '../config/server';
import { startConfigSync } from '../config/sync';
import { connectCloudBackend } from './backendApi';
import { initMetrics } from './metrics';
import { markAppStarted } from './state';
import { startCronJobs, getCronJobsMetadata } from '../cron/jobs';
import { initAuth } from '../auth';
// import { createStsClient } from './aws';
import { Module } from './module';
import { createQuery, createMutation } from '../methods';
import { Store } from '../data/store';

export async function startApp({ configSchema, modules = [] }: { configSchema?: ConfigSchema, modules?: Module[] } = {}) {
  markAppStarted();

  dotenv.config();

  initMethods(modules);

  setSchema(configSchema ?? {});
  const stores = getStores(modules);
  const { mongodbUri, configs } = await connectCloudBackend({
    configSchema,
    cronJobsMetadata: getCronJobsMetadata(),
    stores
  });
  loadConfigs(configs);

  await connect(mongodbUri);
  provisionStores(stores);

  await initAuth();
  await initMetrics();
  startConfigSync();

  if (Number(process.env.MODELENCE_CRON_INSTANCE)) {
    startCronJobs().catch(console.error);
  }

  await startServer();
}

function initMethods(modules: Module[]) {
  for (const module of modules) {
    for (const [key, handler] of Object.entries(module.queries)) {
      createQuery(`${module.name}.${key}`, handler);
    }
    for (const [key, handler] of Object.entries(module.mutations)) {
      createMutation(`${module.name}.${key}`, handler);
    }
  }
}

function getStores(modules: Module[]) {
  return modules.flatMap(module => module.stores);
}

async function provisionStores(stores: Store<any>[]) {
  const client = getClient();
  if (!client) {
    throw new Error('Failed to provision stores: MongoDB client not initialized');
  }

  for (const store of stores) {
    store.provision(client);
  }
}
