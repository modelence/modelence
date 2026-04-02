import dotenv from 'dotenv';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import type { AppServer, ModelSchema } from '../types';
import socketioServer from '@/websocket/socketio/server';
import { initRoles } from '../auth/role';
import sessionModule from '../auth/session';
import { RoleDefinition } from '../auth/types';
import userModule from '../auth/user';
import { getLocalConfigs } from '../config/local';
import { loadConfigs, setSchema } from '../config/server';
import { startConfigSync, loadRemoteConfigs } from '../config/sync';
import { ConfigSchema } from '../config/types';
import cronModule, { defineCronJob, getCronJobsMetadata, startCronJobs } from '../cron/jobs';
import { Store } from '../data/store';
import { resolveStores, toEffectiveStoreMetadata } from '../data/resolveStores';
import { connect, getClient, getMongodbUri } from '../db/client';
import { _createSystemMutation, _createSystemQuery, createMutation, createQuery } from '../methods';
import { MigrationScript, default as migrationModule, startMigrations } from '../migration';
import rateLimitModule from '../rate-limit';
import { initRateLimits } from '../rate-limit/rules';
import systemModule from '../system';
import lockModule, { acquireLock, releaseLock } from '../lock';
import filesModule from '../files';
import { viteServer } from '../viteServer';
import { connectCloudBackend } from './backendApi';
import { initMetrics } from './metrics';
import { Module } from './module';
import { startServer } from './server';
import { markAppStarted, setMetadata } from './state';
import { time } from '@/time';
import { EmailConfig, setEmailConfig } from './emailConfig';
import { AuthConfig, setAuthConfig } from './authConfig';
import { SecurityConfig, setSecurityConfig } from './securityConfig';
import { WebsocketConfig, setWebsocketConfig } from './websocketConfig';

export type AppOptions = {
  modules?: Module[];
  server?: AppServer;
  email?: EmailConfig;
  auth?: AuthConfig;
  /** Security settings such as clickjacking protection. See {@link SecurityConfig}. */
  security?: SecurityConfig;
  /**
   * Custom role definitions keyed by role name. Defined roles are synced to the
   * Modelence Cloud dashboard for user management. See {@link RoleDefinition}.
   *
   * @example
   * ```typescript
   * startApp({
   *   roles: {
   *     admin: { description: 'Full access to all features' },
   *     editor: { description: 'Can edit content' },
   *     viewer: {},
   *   },
   * });
   * ```
   */
  roles?: Record<string, RoleDefinition>;
  /** @internal */
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
  security = {},
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
    filesModule,
  ];
  const combinedModules = [...systemModules, ...modules];

  markAppStarted();

  initSystemMethods(systemModules);
  initCustomMethods(modules);

  initRoles(roles, defaultRoles);

  const configSchema = getConfigSchema(combinedModules);
  setSchema(configSchema);
  const rawStores = getStores(combinedModules) as Store<ModelSchema, never>[];
  const channels = getChannels(combinedModules);

  defineCronJobs(combinedModules);

  const rateLimits = getRateLimits(combinedModules);
  initRateLimits(rateLimits);

  const { storesToInit, effectiveStores } = resolveStores(rawStores) as {
    storesToInit: Store<ModelSchema, never>[];
    effectiveStores: Store<ModelSchema, never>[];
  };
  const effectiveStoreMetadata = toEffectiveStoreMetadata(effectiveStores);

  if (hasRemoteBackend) {
    const { configs, environmentId, appAlias, environmentAlias, telemetry } =
      await connectCloudBackend({
        configSchema,
        cronJobsMetadata: getCronJobsMetadata(),
        stores: rawStores,
        effectiveStores: effectiveStoreMetadata,
        roles,
      });
    loadRemoteConfigs(configs);
    setMetadata({ environmentId, appAlias, environmentAlias, telemetry });
  } else {
    loadConfigs(getLocalConfigs(configSchema));
  }

  setEmailConfig(email);
  setAuthConfig(auth);
  setSecurityConfig(security);
  setWebsocketConfig({
    ...websocket,
    provider: websocket.provider || socketioServer,
  });

  const mongodbUri = getMongodbUri();
  if (mongodbUri) {
    await connect();
    initStores(storesToInit);
    await createIndexesWithLock(effectiveStores);
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

const INDEXES_LOCK_RESOURCE = 'indexes';

async function createIndexesWithLock(effectiveStores: Store<ModelSchema, never>[]) {
  const hasLock = await acquireLock(INDEXES_LOCK_RESOURCE, {
    lockDuration: time.seconds(30),
    heartbeat: true,
  });
  if (!hasLock) {
    return;
  }

  let releaseHandledByBackgroundTask = false;

  try {
    const blockingStores = effectiveStores.filter(
      (store) => store.getIndexCreationMode() === 'blocking'
    );
    const backgroundStores = effectiveStores.filter(
      (store) => store.getIndexCreationMode() === 'background'
    );

    for (const store of blockingStores) {
      await createStoreIndexes(store);
    }

    if (backgroundStores.length > 0) {
      releaseHandledByBackgroundTask = true;
      void Promise.resolve().then(async () => {
        try {
          for (const store of backgroundStores) {
            await createStoreIndexes(store);
          }
        } finally {
          await releaseLock(INDEXES_LOCK_RESOURCE);
        }
      });
    }
  } finally {
    if (!releaseHandledByBackgroundTask) {
      await releaseLock(INDEXES_LOCK_RESOURCE);
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function createStoreIndexes(store: Store<any, any>) {
  const storeName = store.getName();

  try {
    await store.createIndexes();
  } catch (error) {
    warnIndexCreationFailure(storeName, error);
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

function initStores(stores: Store<ModelSchema, never>[]) {
  const client = getClient();
  if (!client) {
    throw new Error('Failed to initialize stores: MongoDB client not initialized');
  }

  for (const store of stores) {
    store.init(client);
  }
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
