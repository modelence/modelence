import os from 'os';
import { getContainerId, isDevRuntime, isLocalRuntime } from './instance';
import { getLocalSiteUrl } from '../config/local';
import { ConfigSchema } from '../config/types';
import { CronJobMetadata } from '../cron/types';
import { RoleDefinition } from '../auth/types';
import { Store } from '../data/store';
import { AppConfig } from '../config/types';
import { ModelSchema } from '../data/types';

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
  roles,
}: {
  configSchema?: ConfigSchema;
  cronJobsMetadata?: CronJobMetadata[];
  stores?: Store<ModelSchema, Record<string, never>>[];
  roles?: Record<string, RoleDefinition>;
}): Promise<CloudBackendConnectOkResponse> {
  const containerId = getContainerId();
  if (!containerId) {
    throw new Error('Unable to connect to Modelence Cloud: MODELENCE_CONTAINER_ID is not set');
  }

  // Set by `modelence dev --takeover`: Studio disconnects whoever holds the
  // environment (pausing a sandbox, or detaching another dev instance) and
  // hands over the lease in the same connect request. Only the `local`
  // runtime may take over — Studio enforces the same rule server-side.
  const takeover = isLocalRuntime() && process.env.MODELENCE_TAKEOVER === '1';

  try {
    const dataStores = (stores ?? []).map((store) => ({
      name: store.getName(),
      schema: store.getSerializedSchema(),
      collections: [store.getName()],
      version: 2,
      indexes: store.getIndexes(),
      searchIndexes: store.getSearchIndexes(),
      indexCreationMode: store.getIndexCreationMode(),
    }));

    const data = await callCloudApi<CloudBackendConnectResponse>('/api/connect', 'POST', {
      hostname: os.hostname(),
      runtime: process.env.MODELENCE_RUNTIME,
      containerId,
      ...(isLocalRuntime() ? { localSiteUrl: getLocalSiteUrl() } : {}),
      ...(takeover ? { force: true } : {}),
      dataModels: dataStores,
      configSchema,
      cronJobsMetadata,
      roles,
    });

    if (data.status === 'error') {
      throw Object.assign(new Error(`Unable to connect to Modelence Cloud: ${data.error}`), {
        responseBody: data,
      });
    }

    console.log('Successfully connected to Modelence Cloud');

    return data;
  } catch (error) {
    const cloudError = error as { message?: string; status?: number; responseBody?: unknown };

    // /api/connect's only 409 is "another instance already holds this
    // environment" — point a developer at the takeover flag.
    if (isLocalRuntime() && cloudError?.status === 409 && !takeover) {
      const detail =
        (cloudError.responseBody as { error?: string } | undefined)?.error ?? cloudError.message;
      console.error(
        `${detail}\nRe-run with the --takeover flag (e.g. npm run dev -- --takeover) to ` +
          'disconnect it and connect this instance instead.'
      );
      process.exit(1);
    }

    // A refusal the server explained (e.g. another instance already holds
    // this environment) is an expected condition on a dev machine: print the
    // message alone and exit instead of an uncaught stack dump.
    if (isDevRuntime() && (cloudError?.status ?? cloudError?.responseBody) !== undefined) {
      console.error(cloudError.message);
      process.exit(1);
    }
    console.error('Unable to connect to Modelence Cloud:', error);
    throw error;
  }
}

export async function fetchConfigs() {
  return callCloudApi<{ configs: AppConfig[] }>('/api/configs', 'GET');
}

export type CloudSyncResponse = { status: 'ok' } | { status: 'detached'; message?: string };

export async function syncStatus() {
  const data = await callCloudApi<CloudSyncResponse>('/api/sync', 'POST', {
    containerId: getContainerId(),
  });
  return data;
}

export async function callCloudApi<T = unknown>(
  endpoint: string,
  method: string,
  payload?: object
): Promise<T> {
  const { MODELENCE_SERVICE_ENDPOINT, MODELENCE_SERVICE_TOKEN } = process.env;

  if (!MODELENCE_SERVICE_ENDPOINT) {
    throw new Error('Unable to connect to Modelence Cloud: MODELENCE_SERVICE_ENDPOINT is not set');
  }

  const response = await fetch(`${MODELENCE_SERVICE_ENDPOINT}${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${MODELENCE_SERVICE_TOKEN}`,
      ...(payload ? { 'Content-Type': 'application/json' } : {}),
    },
    body: payload ? JSON.stringify(payload) : undefined,
  });

  if (!response.ok) {
    const data = await response.text();
    let parsed: unknown;
    let messageDetail: string = data;
    try {
      parsed = JSON.parse(data);
      const errorField = (parsed as { error?: unknown }).error;
      if (typeof errorField === 'string') {
        messageDetail = errorField;
      } else if (errorField && typeof errorField === 'object') {
        // Structured error envelope from newer endpoints — keep the body on
        // the thrown Error so callers can pull a code if they need to.
        const message = (errorField as { message?: unknown }).message;
        if (typeof message === 'string') {
          messageDetail = message;
        }
      }
    } catch {
      /* response was not JSON — fall back to raw text */
    }
    const error = new Error(
      `Unable to connect to Modelence Cloud: HTTP status: ${response.status}, ${messageDetail}`
    );
    if (parsed !== undefined) {
      (error as Error & { responseBody?: unknown }).responseBody = parsed;
    }
    (error as Error & { status?: number }).status = response.status;
    throw error;
  }

  if (response.status === 204 || response.headers?.get('content-length') === '0') {
    return undefined as T;
  }

  return (await response.json()) as T;
}
