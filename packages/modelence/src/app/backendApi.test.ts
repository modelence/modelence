import { connectCloudBackend, fetchConfigs, syncStatus } from './backendApi';

describe('app/backendApi', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('connectCloudBackend', () => {
    it('should throw error when MODELENCE_CONTAINER_ID is not set', async () => {
      delete process.env.MODELENCE_CONTAINER_ID;

      await expect(
        connectCloudBackend({
          stores: [],
        })
      ).rejects.toThrow('Unable to connect to Modelence Cloud: MODELENCE_CONTAINER_ID is not set');
    });

    it('should throw error when MODELENCE_SERVICE_ENDPOINT is not set', async () => {
      process.env.MODELENCE_CONTAINER_ID = 'test-container';
      delete process.env.MODELENCE_SERVICE_ENDPOINT;

      await expect(
        connectCloudBackend({
          stores: [],
        })
      ).rejects.toThrow('Unable to connect to Modelence Cloud: MODELENCE_SERVICE_ENDPOINT is not set');
    });

    it('should accept configSchema and cronJobsMetadata parameters', async () => {
      process.env.MODELENCE_CONTAINER_ID = 'test-container';
      delete process.env.MODELENCE_SERVICE_ENDPOINT;

      await expect(
        connectCloudBackend({
          stores: [],
          configSchema: {
            'test.key': { type: 'string', default: 'test', isPublic: true },
          },
          cronJobsMetadata: [{
            alias: 'testJob',
            description: 'Test job',
            interval: 1000,
            timeout: 5000,
          }],
        })
      ).rejects.toThrow();
    });
  });

  describe('fetchConfigs', () => {
    it('should throw error when MODELENCE_SERVICE_ENDPOINT is not set', async () => {
      delete process.env.MODELENCE_SERVICE_ENDPOINT;

      await expect(fetchConfigs()).rejects.toThrow(
        'Unable to connect to Modelence Cloud: MODELENCE_SERVICE_ENDPOINT is not set'
      );
    });
  });

  describe('syncStatus', () => {
    it('should throw error when MODELENCE_SERVICE_ENDPOINT is not set', async () => {
      delete process.env.MODELENCE_SERVICE_ENDPOINT;

      await expect(syncStatus()).rejects.toThrow(
        'Unable to connect to Modelence Cloud: MODELENCE_SERVICE_ENDPOINT is not set'
      );
    });

    it('should use MODELENCE_CONTAINER_ID from environment', async () => {
      process.env.MODELENCE_CONTAINER_ID = 'test-container-id';
      delete process.env.MODELENCE_SERVICE_ENDPOINT;

      await expect(syncStatus()).rejects.toThrow(
        'Unable to connect to Modelence Cloud: MODELENCE_SERVICE_ENDPOINT is not set'
      );
    });
  });
});
