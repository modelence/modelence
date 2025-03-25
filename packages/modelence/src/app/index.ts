import dotenv from 'dotenv';

import { startServer } from './server';
import { connect, getClient, getMongodbUri } from '../db/client';
import { loadConfigs, setSchema } from '../config/server';
import { startConfigSync } from '../config/sync';
import { connectCloudBackend } from './backendApi';
import { initMetrics } from './metrics';
import { markAppStarted, setMetadata } from './state';
import userModule from '../auth/user';
import sessionModule from '../auth/session';
import { runMigrations, MigrationScript, default as migrationModule } from '../migration';
import { initRoles } from '../auth/role';
import { startCronJobs, getCronJobsMetadata, defineCronJob } from '../cron/jobs';
import cronModule from '../cron/jobs';
import { Module } from './module';
import { createQuery, createMutation, _createSystemQuery, _createSystemMutation } from '../methods';
import { Store } from '../data/store';
import { AppConfig, ConfigSchema } from '../config/types';
import { RoleDefinition } from '../auth/types';
import { AppServer } from '../../types';
import { viteServer } from '../viteServer';

type AppOptions = {
  modules?: Module[],
  server?: AppServer,
  roles?: Record<string, RoleDefinition>,
  defaultRoles?: Record<string, string>,
  migrations?: Array<MigrationScript>
}

export async function startApp(
  { modules = [], roles = {}, defaultRoles = {}, server = viteServer, migrations = [] }: AppOptions
) {
  dotenv.config();
  
  dotenv.config({ path: '.modelence.env' });

  const hasRemoteBackend = Boolean(process.env.MODELENCE_SERVICE_ENDPOINT);
  const isCronEnabled = process.env.MODELENCE_CRON_ENABLED === 'true';

  // TODO: verify that user modules don't start with `_system.` prefix
  const systemModules = [userModule, sessionModule, cronModule, migrationModule];
  const combinedModules = [...systemModules, ...modules];

  markAppStarted();

  initSystemMethods(systemModules);
  initCustomMethods(modules);

  initRoles(roles, defaultRoles);

  const configSchema = getConfigSchema(combinedModules);
  setSchema(configSchema ?? {});
  const stores = getStores(combinedModules);

  if (isCronEnabled) {
    defineCronJobs(combinedModules);
  }

  if (hasRemoteBackend) {
    const { configs, deploymentId, appAlias, deploymentAlias, telemetry } = await connectCloudBackend({
      configSchema,
      cronJobsMetadata: isCronEnabled ? getCronJobsMetadata() : undefined,
      stores
    });
    loadConfigs(configs);
    setMetadata({ deploymentId, appAlias, deploymentAlias, telemetry });
  } else {
    loadConfigs(getLocalConfigs());
  }

  const mongodbUri = getMongodbUri();
  if (mongodbUri) {
    await connect();
    initStores(stores);
  }

  if (isCronEnabled) {
    await runMigrations(migrations);
  }

  if (mongodbUri) {
    for (const store of stores) {
      store.createIndexes();
    }
  }

  if (hasRemoteBackend) {
    await initMetrics();
    startConfigSync();
  }

  if (isCronEnabled) {
    startCronJobs().catch(console.error);
  }

  await startServer(server, { combinedModules });
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

function getConfigSchema(modules: Module[]): ConfigSchema {
  const merged: ConfigSchema = {};

  for (const module of modules) {
    for (const [key, value] of Object.entries(module.configSchema)) {
      const absoluteKey = `${module.name}.${key}`;
      if (absoluteKey in merged) {
        throw new Error(
          `Duplicate config schema key: ${absoluteKey} (${module.name})`
        );
      }

      merged[absoluteKey] = value;
    }
  }

  return merged;
}

function defineCronJobs(modules: Module[]) {
  for (const module of modules) {
    for (const [cronAlias, cronJobParams] of Object.entries(module.cronJobs)) {
      defineCronJob(`${module.name}.${cronAlias}`, cronJobParams);
    }
  }
}

function initStores(stores: Store<any, any>[]) {
  const client = getClient();
  if (!client) {
    throw new Error('Failed to initialize stores: MongoDB client not initialized');
  }

  for (const store of stores) {
    store.init(client);
  }
}

function getLocalConfigs(): AppConfig[] {
  const configs: AppConfig[] = [];

  if (process.env.MONGODB_URI) {
    configs.push({
      key: '_system.mongodbUri',
      type: 'string',
      value: process.env.MONGODB_URI
    });
  }

  return configs;
}
