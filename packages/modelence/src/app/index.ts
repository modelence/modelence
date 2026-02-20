import dotenv from 'dotenv';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import type { AppServer } from '../types';
import socketioServer from '@/websocket/socketio/server';
import { initRoles } from '../auth/role';
import sessionModule from '../auth/session';
import { RoleDefinition } from '../auth/types';
import userModule from '../auth/user';
import { loadConfigs, setSchema } from '../config/server';
import { startConfigSync } from '../config/sync';
import { AppConfig, ConfigSchema, ConfigType } from '../config/types';
import cronModule, { defineCronJob, getCronJobsMetadata, startCronJobs } from '../cron/jobs';
import { Store } from '../data/store';
import { connect, getClient, getMongodbUri } from '../db/client';
import { _createSystemMutation, _createSystemQuery, createMutation, createQuery } from '../methods';
import { MigrationScript, default as migrationModule, startMigrations } from '../migration';
import rateLimitModule from '../rate-limit';
import { initRateLimits } from '../rate-limit/rules';
import systemModule from '../system';
import lockModule from '../lock';
import { viteServer } from '../viteServer';
import { connectCloudBackend } from './backendApi';
import { initMetrics } from './metrics';
import { Module } from './module';
import { startServer } from './server';
import { markAppStarted, setMetadata } from './state';
import { EmailConfig, setEmailConfig } from './emailConfig';
import { AuthConfig, setAuthConfig } from './authConfig';
import { WebsocketConfig, setWebsocketConfig } from './websocketConfig';

export type AppOptions = {
  modules?: Module[];
  server?: AppServer;
  email?: EmailConfig;
  auth?: AuthConfig;
  roles?: Record<string, RoleDefinition>;
  defaultRoles?: Record<string, string>;
  migrations?: Array<MigrationScript>;
  websocket?: WebsocketConfig;
};

export async function startApp({
  modules = [],
  roles = {},
  defaultRoles = {},
  server = viteServer,
  migrations = [],
  email = {},
  auth = {},
  websocket = {},
}: AppOptions) {
  dotenv.config();

  dotenv.config({ path: '.modelence.env' });

  const hasRemoteBackend = Boolean(process.env.MODELENCE_SERVICE_ENDPOINT);

  trackAppStart()
    .then(() => {
      // Do nothing
    })
    .catch(() => {
      // Silently ignore tracking errors to not disrupt app startup
    });

  // TODO: verify that user modules don't start with `_system.` prefix
  const systemModules = [
    userModule,
    sessionModule,
    cronModule,
    migrationModule,
    rateLimitModule,
    systemModule,
    lockModule,
  ];
  const combinedModules = [...systemModules, ...modules];

  markAppStarted();

  initSystemMethods(systemModules);
  initCustomMethods(modules);

  initRoles(roles, defaultRoles);

  const configSchema = getConfigSchema(combinedModules);
  setSchema(configSchema);
  const stores = getStores(combinedModules);
  const channels = getChannels(combinedModules);

  defineCronJobs(combinedModules);

  const rateLimits = getRateLimits(combinedModules);
  initRateLimits(rateLimits);

  if (hasRemoteBackend) {
    const { configs, environmentId, appAlias, environmentAlias, telemetry } =
      await connectCloudBackend({
        configSchema,
        cronJobsMetadata: getCronJobsMetadata(),
        stores,
      });
    loadConfigs(configs);
    setMetadata({ environmentId, appAlias, environmentAlias, telemetry });
  } else {
    loadConfigs(getLocalConfigs(configSchema));
  }

  setEmailConfig(email);
  setAuthConfig(auth);
  setWebsocketConfig({
    ...websocket,
    provider: websocket.provider || socketioServer,
  });

  const mongodbUri = getMongodbUri();
  if (mongodbUri) {
    await connect();
    initStores(stores);

    for (const store of stores) {
      if (store.getIndexCreationMode() === 'blocking') {
        await createStoreIndexes(store);
      }
    }

    for (const store of stores) {
      if (store.getIndexCreationMode() === 'background') {
        void Promise.resolve().then(() => createStoreIndexes(store));
      }
    }
  }

  startMigrations(migrations);

  if (hasRemoteBackend) {
    await initMetrics();
    startConfigSync();
  }

  startCronJobs().catch(console.error);

  await startServer(server, { combinedModules, channels });
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
  return modules.flatMap((module) => module.stores);
}

function getChannels(modules: Module[]) {
  return modules.flatMap((module) => module.channels);
}

function getRateLimits(modules: Module[]) {
  return modules.flatMap((module) => module.rateLimits);
}

function warnIndexCreationFailure(storeName: string, error: unknown) {
  console.warn(`Failed to create indexes for store '${storeName}'. Continuing startup.`, error);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function createStoreIndexes(store: Store<any, any>) {
  try {
    await store.createIndexes();
  } catch (error) {
    warnIndexCreationFailure(store.getName(), error);
  }
}

function getConfigSchema(modules: Module[]): ConfigSchema {
  const merged: ConfigSchema = {};

  for (const module of modules) {
    for (const [key, value] of Object.entries(module.configSchema)) {
      const absoluteKey = `${module.name}.${key}`;
      if (absoluteKey in merged) {
        throw new Error(`Duplicate config schema key: ${absoluteKey} (${module.name})`);
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  MODELENCE_AUTH_GOOGLE_ENABLED: '_system.user.auth.google.enabled',
  MODELENCE_AUTH_GOOGLE_CLIENT_ID: '_system.user.auth.google.clientId',
  MODELENCE_AUTH_GOOGLE_CLIENT_SECRET: '_system.user.auth.google.clientSecret',
  MODELENCE_AUTH_GITHUB_ENABLED: '_system.user.auth.github.enabled',
  MODELENCE_AUTH_GITHUB_CLIENT_ID: '_system.user.auth.github.clientId',
  MODELENCE_AUTH_GITHUB_CLIENT_SECRET: '_system.user.auth.github.clientSecret',
  MODELENCE_AUTH_GITHUB_CLIENT_SCOPES: '_system.user.auth.github.scopes',
  MODELENCE_EMAIL_RESEND_API_KEY: '_system.email.resend.apiKey',
  MODELENCE_EMAIL_AWS_SES_REGION: '_system.email.awsSes.region',
  MODELENCE_EMAIL_AWS_SES_ACCESS_KEY_ID: '_system.email.awsSes.accessKeyId',
  MODELENCE_EMAIL_AWS_SES_SECRET_ACCESS_KEY: '_system.email.awsSes.secretAccessKey',
  MODELENCE_EMAIL_SMTP_HOST: '_system.email.smtp.host',
  MODELENCE_EMAIL_SMTP_PORT: '_system.email.smtp.port',
  MODELENCE_EMAIL_SMTP_USER: '_system.email.smtp.user',
  MODELENCE_EMAIL_SMTP_PASS: '_system.email.smtp.pass',
  MODELENCE_SITE_URL: '_system.site.url',
  MODELENCE_ENV: '_system.env',
  // deprecated
  GOOGLE_AUTH_ENABLED: '_system.user.auth.google.enabled',
  GOOGLE_AUTH_CLIENT_ID: '_system.user.auth.google.clientId',
  GOOGLE_AUTH_CLIENT_SECRET: '_system.user.auth.google.clientSecret',
};

function formatLocalConfigValue(value: string, type: ConfigType): string | number | boolean {
  if (type === 'number') {
    const numValue = Number(value);
    if (isNaN(numValue)) {
      throw new Error(`Invalid number value for config: ${value}`);
    }
    return numValue;
  }
  if (type === 'boolean') {
    if (value.toLowerCase() === 'true') {
      return true;
    }
    if (value.toLowerCase() === 'false') {
      return false;
    }
    throw new Error(`Invalid boolean value for config: ${value}`);
  }
  return value;
}

function getLocalConfigs(configSchema: ConfigSchema): AppConfig[] {
  const configs: AppConfig[] = [];

  for (const [envVar, configKey] of Object.entries(localConfigMap)) {
    const value = process.env[envVar];
    const configSchemaEntry = configSchema[configKey];
    if (value) {
      const type = configSchemaEntry?.type ?? 'string';
      configs.push({
        key: configKey,
        type: type,
        value: formatLocalConfigValue(value, type),
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
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        projectName: appDetails.name,
        version: modelencePackageJson.default.version,
        localHostname: os.hostname(),
        environmentId,
      }),
    });
  }
}

async function getAppDetails() {
  try {
    const packageJsonPath = path.join(process.cwd(), 'package.json');
    const packageJsonContent = await fs.readFile(packageJsonPath, 'utf-8');
    const packageJson = JSON.parse(packageJsonContent);

    return {
      name: packageJson.name || 'unknown',
    };
  } catch {
    return {
      name: 'unknown',
    };
  }
}
