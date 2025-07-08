import dotenv from 'dotenv';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import { AppServer } from '@modelence/types';
import { initRoles } from '../auth/role';
import sessionModule from '../auth/session';
import { RoleDefinition } from '../auth/types';
import userModule from '../auth/user';
import { loadConfigs, setSchema } from '../config/server';
import { startConfigSync } from '../config/sync';
import { AppConfig, ConfigSchema } from '../config/types';
import cronModule, { defineCronJob, getCronJobsMetadata, startCronJobs } from '../cron/jobs';
import { Store } from '../data/store';
import { connect, getClient, getMongodbUri } from '../db/client';
import { _createSystemMutation, _createSystemQuery, createMutation, createQuery } from '../methods';
import { MigrationScript, default as migrationModule, runMigrations } from '../migration';
import rateLimitModule from '../rate-limit';
import { initRateLimits } from '../rate-limit/rules';
import { viteServer } from '../viteServer';
import { connectCloudBackend } from './backendApi';
import { initMetrics } from './metrics';
import { Module } from './module';
import { startServer } from './server';
import { markAppStarted, setMetadata } from './state';

export type AppOptions = {
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

  trackAppStart().then(() => {
    // Do nothing
  }).catch(() => {
    // Silently ignore tracking errors to not disrupt app startup
  });

  // TODO: verify that user modules don't start with `_system.` prefix
  const systemModules = [userModule, sessionModule, cronModule, migrationModule, rateLimitModule];
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

  const rateLimits = getRateLimits(combinedModules);
  initRateLimits(rateLimits);

  if (hasRemoteBackend) {
    const { configs, environmentId, appAlias, environmentAlias, telemetry } = await connectCloudBackend({
      configSchema,
      cronJobsMetadata: isCronEnabled ? getCronJobsMetadata() : undefined,
      stores
    });
    loadConfigs(configs);
    setMetadata({ environmentId, appAlias, environmentAlias, telemetry });
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

function getRateLimits(modules: Module[]) {
  return modules.flatMap(module => module.rateLimits);
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

const localConfigMap = {
  MONGODB_URI: '_system.mongodbUri',
  GOOGLE_AUTH_ENABLED: '_system.user.auth.google.enabled',
  GOOGLE_AUTH_CLIENT_ID: '_system.user.auth.google.clientId',
  GOOGLE_AUTH_CLIENT_SECRET: '_system.user.auth.google.clientSecret',
};

function getLocalConfigs(): AppConfig[] {
  const configs: AppConfig[] = [];

  for (const [envVar, configKey] of Object.entries(localConfigMap)) {
    const value = process.env[envVar];
    if (value) {
      configs.push({
        key: configKey,
        type: 'string',
        value,
      });
    }
  }

  return configs;
}

async function trackAppStart() {
  const isTrackingEnabled = process.env.MODELENCE_TRACKING_ENABLED !== 'false';

  if (isTrackingEnabled) {
    const serviceEndpoint = process.env.MODELENCE_SERVICE_ENDPOINT ?? 'https://cloud.modelence.com';
    const environmentId = process.env.MODELENCE_ENVIRONMENT_ID;
    
    const appDetails = await getAppDetails();
    const modelencePackageJson = await import('../../package.json');
    
    await fetch(`${serviceEndpoint}/api/track/app-start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        projectName: appDetails.name,
        version: modelencePackageJson.default.version,
        localHostname: os.hostname(),
        environmentId
      })
    });
  }
}

async function getAppDetails() {
  try {
    const packageJsonPath = path.join(process.cwd(), 'package.json');
    const packageJsonContent = await fs.readFile(packageJsonPath, 'utf-8');
    const packageJson = JSON.parse(packageJsonContent);
    
    return {
      name: packageJson.name || 'unknown'
    };
  } catch (error) {
    return {
      name: 'unknown'
    };
  }
}
