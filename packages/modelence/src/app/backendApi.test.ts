import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import os from 'os';
import type { Store } from '../data/store';
import type { ModelSchema } from '../data/types';
import type { CronJobMetadata } from '../cron/types';
import type { ConfigSchema } from '../config/types';
import { connectCloudBackend, fetchConfigs, syncStatus } from './backendApi';

type BaseStore = Store<ModelSchema, Record<string, never>>;
type MockStore = Pick<BaseStore, 'getName' | 'getSerializedSchema'>;

const createStore = (name: string, schema: object = { fields: name }): MockStore =>
  ({
    getName: () => name,
    getSerializedSchema: () => schema,
  }) as MockStore;

const asStoreArray = (stores: MockStore[]): BaseStore[] => stores as unknown as BaseStore[];

describe('app/backendApi', () => {
  const originalEnv = process.env;
  const originalFetch = global.fetch;
  const fetchMock = jest.fn<typeof fetch>();

  beforeEach(() => {
    process.env = { ...originalEnv };
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  describe('connectCloudBackend', () => {
    test('throws when MODELENCE_CONTAINER_ID is missing', async () => {
      delete process.env.MODELENCE_CONTAINER_ID;

      await expect(
        connectCloudBackend({
          stores: [],
        })
      ).rejects.toThrow('Unable to connect to Modelence Cloud: MODELENCE_CONTAINER_ID is not set');
    });

    test('posts store metadata and returns cloud configuration', async () => {
      process.env.MODELENCE_CONTAINER_ID = 'container-123';
      process.env.MODELENCE_SERVICE_ENDPOINT = 'https://cloud.modelence.test';
      process.env.MODELENCE_SERVICE_TOKEN = 'token-abc';

      const hostnameSpy = jest.spyOn(os, 'hostname').mockReturnValue('app-host');

      const okResponse = {
        status: 'ok',
        configs: [{ alias: 'app', values: {} }],
        environmentId: 'env-1',
        appAlias: 'app-alias',
        environmentAlias: 'env-alias',
        telemetry: {
          isEnabled: true,
          serviceName: 'modelence-app',
        },
      } as const;

      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => okResponse,
      } as unknown as Response);

      const configSchema: ConfigSchema = {
        'public.key': { type: 'string', default: 'value', isPublic: true },
      };

      const cronJobsMetadata: CronJobMetadata[] = [
        { alias: 'daily-job', description: 'runs daily', interval: 3600, timeout: 60 },
      ];

      const storeMocks = [
        createStore('users', { name: 'users' }),
        createStore('sessions', { name: 'sessions' }),
      ];

      const result = await connectCloudBackend({
        configSchema,
        cronJobsMetadata,
        stores: asStoreArray(storeMocks),
      });

      expect(result).toEqual(okResponse);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith(
        'https://cloud.modelence.test/api/connect',
        expect.objectContaining({
          method: 'POST',
          headers: {
            Authorization: 'Bearer token-abc',
            'Content-Type': 'application/json',
          },
        })
      );
      const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
      const body = JSON.parse((requestInit?.body as string) ?? '{}');
      expect(body).toMatchObject({
        hostname: 'app-host',
        containerId: 'container-123',
        configSchema,
        cronJobsMetadata,
        dataModels: [
          { name: 'users', schema: { name: 'users' }, collections: ['users'], version: 2 },
          { name: 'sessions', schema: { name: 'sessions' }, collections: ['sessions'], version: 2 },
        ],
      });
      expect(hostnameSpy).toHaveBeenCalled();
    });

    test('throws when cloud returns an error response body', async () => {
      process.env.MODELENCE_CONTAINER_ID = 'container-123';
      process.env.MODELENCE_SERVICE_ENDPOINT = 'https://cloud.modelence.test';

      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ status: 'error', error: 'invalid container' }),
      } as unknown as Response);

      const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

      await expect(
        connectCloudBackend({
          stores: asStoreArray([createStore('users')]),
        })
      ).rejects.toThrow('invalid container');

      expect(consoleError).toHaveBeenCalledWith(
        'Unable to connect to Modelence Cloud:',
        expect.any(Error)
      );
    });

    test('throws when MODELENCE_SERVICE_ENDPOINT is missing', async () => {
      process.env.MODELENCE_CONTAINER_ID = 'container-123';
      delete process.env.MODELENCE_SERVICE_ENDPOINT;

      await expect(
        connectCloudBackend({
          stores: [],
        })
      ).rejects.toThrow(
        'Unable to connect to Modelence Cloud: MODELENCE_SERVICE_ENDPOINT is not set'
      );
    });
  });

  describe('fetchConfigs', () => {
    test('throws when MODELENCE_SERVICE_ENDPOINT is not set', async () => {
      delete process.env.MODELENCE_SERVICE_ENDPOINT;

      await expect(fetchConfigs()).rejects.toThrow(
        'Unable to connect to Modelence Cloud: MODELENCE_SERVICE_ENDPOINT is not set'
      );
    });

    test('requests configs with service token', async () => {
      process.env.MODELENCE_SERVICE_ENDPOINT = 'https://cloud.modelence.test';
      process.env.MODELENCE_SERVICE_TOKEN = 'token-abc';

      const responseBody = { configs: [] };
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => responseBody,
      } as unknown as Response);

      const result = await fetchConfigs();

      expect(result).toEqual(responseBody);
      expect(fetchMock).toHaveBeenCalledWith(
        'https://cloud.modelence.test/api/configs',
        expect.objectContaining({
          method: 'GET',
          headers: {
            Authorization: 'Bearer token-abc',
          },
          body: undefined,
        })
      );
    });
  });

  describe('syncStatus', () => {
    test('throws when MODELENCE_SERVICE_ENDPOINT is not set', async () => {
      delete process.env.MODELENCE_SERVICE_ENDPOINT;

      await expect(syncStatus()).rejects.toThrow(
        'Unable to connect to Modelence Cloud: MODELENCE_SERVICE_ENDPOINT is not set'
      );
    });

    test('posts container status to sync endpoint', async () => {
      process.env.MODELENCE_SERVICE_ENDPOINT = 'https://cloud.modelence.test';
      process.env.MODELENCE_SERVICE_TOKEN = 'token-abc';
      process.env.MODELENCE_CONTAINER_ID = 'container-123';

      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ status: 'ok' }),
      } as unknown as Response);

      const result = await syncStatus();

      expect(result).toEqual({ status: 'ok' });
      expect(fetchMock).toHaveBeenCalledWith(
        'https://cloud.modelence.test/api/sync',
        expect.objectContaining({
          method: 'POST',
          headers: {
            Authorization: 'Bearer token-abc',
            'Content-Type': 'application/json',
          },
        })
      );
      const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
      const body = JSON.parse((requestInit?.body as string) ?? '{}');
      expect(body).toEqual({
        containerId: 'container-123',
      });
    });
  });
});
