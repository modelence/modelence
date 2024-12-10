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
import userModule from '../auth/user';
import sessionModule from '../auth/session';
import cronModule from '../cron/jobs';
// import { createStsClient } from './aws';
import { Module } from './module';
import { createQuery, createMutation, _createSystemQuery, _createSystemMutation } from '../methods';
import { Store } from '../data/store';

export async function startApp(
  { configSchema, modules = [] }: {
    configSchema?: ConfigSchema,
    modules?: Module[]
  } = {}
) {
  dotenv.config();

  const hasRemoteBackend = Boolean(process.env.MODELENCE_SERVICE_ENDPOINT);

  // TODO: verify that user modules don't start with `_system.` prefix
  const systemModules = [userModule, sessionModule, cronModule];
  const combinedModules = [...systemModules, ...modules];

  markAppStarted();

  initSystemMethods(systemModules);
  initCustomMethods(modules);

  setSchema(configSchema ?? {});
  const stores = getStores(combinedModules);

  if (hasRemoteBackend) {
    const { mongodbUri, configs } = await connectCloudBackend({
      configSchema,
      cronJobsMetadata: getCronJobsMetadata(),
      stores
    });
    loadConfigs(configs);

    await connect(mongodbUri);
  } else {
    // TODO: connect to local MongoDB

    // TODO: allow loading configs from a JSON file 
    loadConfigs([]);
  }

  if (hasRemoteBackend) {
    provisionStores(stores);
  }

  if (hasRemoteBackend) {
    await initMetrics();
    startConfigSync();
  }

  if (Number(process.env.MODELENCE_CRON_INSTANCE)) {
    startCronJobs().catch(console.error);
  }

  await startServer({ combinedModules });
}

function initCustomMethods(modules: Module[]) {
  for (const module of modules) {
    for (const [key, handler] of Object.entries(module.queries)) {
      createQuery(`${module.name}.${key}`, handler);
    }
    for (const [key, handler] of Object.entries(module.mutations)) {
      createMutation(`${module.name}.${key}`, handler);
    }
  }
}

function initSystemMethods(modules: Module[]) {
  for (const module of modules) {
    for (const [key, handler] of Object.entries(module.queries)) {
      _createSystemQuery(`${module.name}.${key}`, handler);
    }
    for (const [key, handler] of Object.entries(module.mutations)) {
      _createSystemMutation(`${module.name}.${key}`, handler);
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
