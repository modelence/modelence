import os from 'os';
import { ConfigSchema } from '../config/types';
import { CronJobMetadata } from '../cron/types';
import { RoleDefinition } from '../auth/types';
import { Store } from '../data/store';
import { serializeModelSchema } from '../data/schemaSerializer';
import { AppConfig } from '../config/types';
import { ModelSchema } from '../data/types';
import { EffectiveStoreMetadata } from '../data/resolveStores';

type CloudBackendConnectOkResponse = {
  status: 'ok';
  configs: AppConfig[];
  environmentId: string;
  appAlias: string;
  environmentAlias: string;
  telemetry: {
    isEnabled: boolean;
    serviceName: string;
  };
};

type CloudBackendConnectErrorResponse = {
  status: 'error';
  error: string;
};

export type CloudBackendConnectResponse =
  | CloudBackendConnectOkResponse
  | CloudBackendConnectErrorResponse;

export async function connectCloudBackend({
  configSchema,
  cronJobsMetadata,
  stores,
  effectiveStores,
  roles,
}: {
  configSchema?: ConfigSchema;
  cronJobsMetadata?: CronJobMetadata[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  stores: Store<any, any>[];
  effectiveStores?: EffectiveStoreMetadata[];
  roles?: Record<string, RoleDefinition>;
}): Promise<CloudBackendConnectOkResponse> {
  const containerId = process.env.MODELENCE_CONTAINER_ID;
  if (!containerId) {
    throw new Error('Unable to connect to Modelence Cloud: MODELENCE_CONTAINER_ID is not set');
  }

  try {
    const dataStores = (effectiveStores ?? []).map((store) => ({
      name: store.name,
      schema: serializeModelSchema(store.schema as ModelSchema),
      collections: [store.name],
      version: 2,
      indexes: store.indexes,
      searchIndexes: store.searchIndexes,
      indexCreationMode: store.indexCreationMode,
    }));

    const data = await callApi<CloudBackendConnectResponse>('/api/connect', 'POST', {
      hostname: os.hostname(),
      containerId,
      dataModels: dataStores,
      configSchema,
      cronJobsMetadata,
      roles,
    });

    if (data.status === 'error') {
      throw new Error(data.error);
    }

    console.log('Successfully connected to Modelence Cloud');

    return data;
  } catch (error) {
    console.error('Unable to connect to Modelence Cloud:', error);
    throw error;
  }
}

export async function fetchConfigs() {
  return callApi<{ configs: AppConfig[] }>('/api/configs', 'GET');
}

export async function syncStatus() {
  const data = await callApi('/api/sync', 'POST', {
    containerId: process.env.MODELENCE_CONTAINER_ID,
  });
  return data;
}

async function callApi<T = unknown>(endpoint: string, method: string, payload?: object) {
  return callCloudApi<T>(
    endpoint,
    method,
    payload ? JSON.stringify(payload) : undefined,
    payload ? { 'Content-Type': 'application/json' } : {}
  );
}

export async function callCloudApi<T>(
  endpoint: string,
  method: string,
  body?: BodyInit,
  extraHeaders?: Record<string, string>
): Promise<T> {
  const { MODELENCE_SERVICE_ENDPOINT, MODELENCE_SERVICE_TOKEN } = process.env;

  if (!MODELENCE_SERVICE_ENDPOINT) {
    throw new Error('Unable to connect to Modelence Cloud: MODELENCE_SERVICE_ENDPOINT is not set');
  }

  const response = await fetch(`${MODELENCE_SERVICE_ENDPOINT}${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${MODELENCE_SERVICE_TOKEN}`,
      ...extraHeaders,
    },
    body,
  });

  if (!response.ok) {
    const data = await response.text();
    try {
      const json = JSON.parse(data);
      throw new Error(
        `Unable to connect to Modelence Cloud: HTTP status: ${response.status}, ${json?.error}`
      );
    } catch {
      throw new Error(
        `Unable to connect to Modelence Cloud: HTTP status: ${response.status}, ${data}`
      );
    }
  }

  if (response.status === 204 || response.headers?.get('content-length') === '0') {
    return undefined as T;
  }

  return (await response.json()) as T;
}
