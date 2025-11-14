import { describe, test, expect, jest, beforeEach } from '@jest/globals';
import type { Module } from './module';
import type { MigrationScript } from '../migration';

// Mock external dependencies
const mockDotenvConfig = jest.fn();
const mockConnect = jest.fn();
const mockGetMongodbUri = jest.fn();
const mockGetClient = jest.fn();
const mockStartServer = jest.fn();
const mockSetSchema = jest.fn();
const mockLoadConfigs = jest.fn();
const mockInitRoles = jest.fn();
const mockInitRateLimits = jest.fn();
const mockSetEmailConfig = jest.fn();
const mockSetAuthConfig = jest.fn();
const mockSetWebsocketConfig = jest.fn();
const mockMarkAppStarted = jest.fn();
const mockSetMetadata = jest.fn();
const mockConnectCloudBackend = jest.fn();
const mockInitMetrics = jest.fn();
const mockStartConfigSync = jest.fn();
const mockStartMigrations = jest.fn();
const mockStartCronJobs = jest.fn();
const mockDefineCronJob = jest.fn();
const mockGetCronJobsMetadata = jest.fn();
const mockCreateQuery = jest.fn();
const mockCreateMutation = jest.fn();
const mockCreateSystemQuery = jest.fn();
const mockCreateSystemMutation = jest.fn();
const mockSocketioServer = { listen: jest.fn() };

jest.unstable_mockModule('dotenv', () => ({
  default: { config: mockDotenvConfig },
}));

jest.unstable_mockModule('../db/client', () => ({
  connect: mockConnect,
  getMongodbUri: mockGetMongodbUri,
  getClient: mockGetClient,
}));

jest.unstable_mockModule('./server', () => ({
  startServer: mockStartServer,
}));

jest.unstable_mockModule('../config/server', () => ({
  setSchema: mockSetSchema,
  loadConfigs: mockLoadConfigs,
}));

jest.unstable_mockModule('../auth/role', () => ({
  initRoles: mockInitRoles,
}));

jest.unstable_mockModule('../rate-limit/rules', () => ({
  initRateLimits: mockInitRateLimits,
}));

jest.unstable_mockModule('./emailConfig', () => ({
  setEmailConfig: mockSetEmailConfig,
}));

jest.unstable_mockModule('./authConfig', () => ({
  setAuthConfig: mockSetAuthConfig,
}));

jest.unstable_mockModule('./websocketConfig', () => ({
  setWebsocketConfig: mockSetWebsocketConfig,
}));

jest.unstable_mockModule('./state', () => ({
  markAppStarted: mockMarkAppStarted,
  setMetadata: mockSetMetadata,
}));

jest.unstable_mockModule('./backendApi', () => ({
  connectCloudBackend: mockConnectCloudBackend,
}));

jest.unstable_mockModule('./metrics', () => ({
  initMetrics: mockInitMetrics,
}));

jest.unstable_mockModule('../config/sync', () => ({
  startConfigSync: mockStartConfigSync,
}));

jest.unstable_mockModule('../migration', () => ({
  default: {
    name: '_system.migration',
    queries: {},
    mutations: {},
    stores: [],
    channels: [],
    rateLimits: [],
    cronJobs: {},
    configSchema: {},
  },
  startMigrations: mockStartMigrations,
}));

jest.unstable_mockModule('../cron/jobs', () => ({
  default: {
    name: '_system.cron',
    queries: {},
    mutations: {},
    stores: [],
    channels: [],
    rateLimits: [],
    cronJobs: {},
    configSchema: {},
  },
  defineCronJob: mockDefineCronJob,
  getCronJobsMetadata: mockGetCronJobsMetadata,
  startCronJobs: mockStartCronJobs,
}));

jest.unstable_mockModule('../methods', () => ({
  createQuery: mockCreateQuery,
  createMutation: mockCreateMutation,
  _createSystemQuery: mockCreateSystemQuery,
  _createSystemMutation: mockCreateSystemMutation,
}));

jest.unstable_mockModule('@/websocket/socketio/server', () => ({
  default: mockSocketioServer,
}));

jest.unstable_mockModule('../auth/user', () => ({
  default: {
    name: '_system.user',
    queries: {},
    mutations: {},
    stores: [],
    channels: [],
    rateLimits: [],
    cronJobs: {},
    configSchema: {},
  },
}));

jest.unstable_mockModule('../auth/session', () => ({
  default: {
    name: '_system.session',
    queries: {},
    mutations: {},
    stores: [],
    channels: [],
    rateLimits: [],
    cronJobs: {},
    configSchema: {},
  },
}));

jest.unstable_mockModule('../rate-limit', () => ({
  default: {
    name: '_system.rateLimit',
    queries: {},
    mutations: {},
    stores: [],
    channels: [],
    rateLimits: [],
    cronJobs: {},
    configSchema: {},
  },
}));

jest.unstable_mockModule('../system', () => ({
  default: {
    name: '_system.system',
    queries: {},
    mutations: {},
    stores: [],
    channels: [],
    rateLimits: [],
    cronJobs: {},
    configSchema: {},
  },
}));

jest.unstable_mockModule('../lock', () => ({
  default: {
    name: '_system.lock',
    queries: {},
    mutations: {},
    stores: [],
    channels: [],
    rateLimits: [],
    cronJobs: {},
    configSchema: {},
  },
}));

jest.unstable_mockModule('../viteServer', () => ({
  viteServer: { listen: jest.fn() },
}));

const { startApp } = await import('./index');

// Helper to create a test module
function createTestModule(overrides: Partial<Module> = {}): Module {
  return {
    name: 'testModule',
    queries: {},
    mutations: {},
    stores: [],
    channels: [],
    rateLimits: [],
    cronJobs: {},
    configSchema: {},
    routes: [],
    ...overrides,
  } as Module;
}

describe('app/index', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetMongodbUri.mockReturnValue('');
    (mockConnectCloudBackend as jest.MockedFunction<any>).mockResolvedValue({
      configs: [],
      environmentId: 'env-123',
      appAlias: 'test-app',
      environmentAlias: 'test-env',
      telemetry: {},
    });
    (mockStartCronJobs as jest.MockedFunction<any>).mockResolvedValue(undefined);
    delete process.env.MODELENCE_SERVICE_ENDPOINT;
    delete process.env.MODELENCE_CRON_ENABLED;
  });

  test('marks app as started', async () => {
    await startApp({});

    expect(mockMarkAppStarted).toHaveBeenCalledTimes(1);
  });

  test('loads dotenv configuration', async () => {
    await startApp({});

    expect(mockDotenvConfig).toHaveBeenCalledTimes(2);
    expect(mockDotenvConfig).toHaveBeenNthCalledWith(1);
    expect(mockDotenvConfig).toHaveBeenNthCalledWith(2, { path: '.modelence.env' });
  });

  test('initializes roles with provided config', async () => {
    const roles = { admin: { permissions: [] } };
    const defaultRoles = { authenticated: 'user' };

    await startApp({ roles, defaultRoles });

    expect(mockInitRoles).toHaveBeenCalledWith(roles, defaultRoles);
  });

  test('sets email, auth, and websocket configs', async () => {
    const email = { from: 'test@example.com' };
    const auth = { onAfterLogin: jest.fn(async () => {}) };
    const websocket = {};

    await startApp({ email, auth, websocket });

    expect(mockSetEmailConfig).toHaveBeenCalledWith(email);
    expect(mockSetAuthConfig).toHaveBeenCalledWith(auth);
    expect(mockSetWebsocketConfig).toHaveBeenCalledWith({
      ...websocket,
      provider: mockSocketioServer,
    });
  });

  test('uses default socketio provider when websocket provider not specified', async () => {
    await startApp({ websocket: {} });

    expect(mockSetWebsocketConfig).toHaveBeenCalledWith({
      provider: mockSocketioServer,
    });
  });

  test('uses custom websocket provider when specified', async () => {
    const customProvider = {
      listen: jest.fn(),
      init: jest.fn(),
      broadcast: jest.fn(),
    } as any;
    await startApp({ websocket: { provider: customProvider } });

    expect(mockSetWebsocketConfig).toHaveBeenCalledWith({
      provider: customProvider,
    });
  });

  test('connects to database when mongodb uri is provided', async () => {
    mockGetMongodbUri.mockReturnValue('mongodb://localhost:27017/test');
    const mockClient = { db: jest.fn() };
    mockGetClient.mockReturnValue(mockClient);

    const mockStore = {
      init: jest.fn(),
      createIndexes: jest.fn(),
    } as any;

    await startApp({
      modules: [createTestModule({ stores: [mockStore] })],
    });

    expect(mockConnect).toHaveBeenCalled();
    expect(mockStore.init).toHaveBeenCalledWith(mockClient);
    expect(mockStore.createIndexes).toHaveBeenCalled();
  });

  test('does not connect to database when mongodb uri is not provided', async () => {
    mockGetMongodbUri.mockReturnValue('');

    await startApp({});

    expect(mockConnect).not.toHaveBeenCalled();
  });

  test('initializes custom module methods', async () => {
    const queryHandler = jest.fn();
    const mutationHandler = jest.fn();

    await startApp({
      modules: [
        createTestModule({
          name: 'customModule',
          queries: { getItems: queryHandler },
          mutations: { createItem: mutationHandler },
        }),
      ],
    });

    expect(mockCreateQuery).toHaveBeenCalledWith('customModule.getItems', queryHandler);
    expect(mockCreateMutation).toHaveBeenCalledWith('customModule.createItem', mutationHandler);
  });

  test('collects stores from all modules', async () => {
    const store1 = { init: jest.fn(), createIndexes: jest.fn() } as any;
    const store2 = { init: jest.fn(), createIndexes: jest.fn() } as any;

    mockGetMongodbUri.mockReturnValue('mongodb://localhost:27017/test');
    mockGetClient.mockReturnValue({ db: jest.fn() });

    await startApp({
      modules: [
        createTestModule({ name: 'module1', stores: [store1] }),
        createTestModule({ name: 'module2', stores: [store2] }),
      ],
    });

    expect(store1.init).toHaveBeenCalled();
    expect(store2.init).toHaveBeenCalled();
  });

  test('collects rate limits from modules and initializes them', async () => {
    const rateLimit1 = { name: 'limit1', limit: 100 } as any;
    const rateLimit2 = { name: 'limit2', limit: 200 } as any;

    await startApp({
      modules: [
        createTestModule({ name: 'module1', rateLimits: [rateLimit1] }),
        createTestModule({ name: 'module2', rateLimits: [rateLimit2] }),
      ],
    });

    expect(mockInitRateLimits).toHaveBeenCalledWith([rateLimit1, rateLimit2]);
  });

  test('defines cron jobs when cron is enabled', async () => {
    process.env.MODELENCE_CRON_ENABLED = 'true';

    await startApp({
      modules: [
        createTestModule({
          name: 'cronModule',
          cronJobs: {
            dailyTask: { interval: 86400000, handler: jest.fn(async () => {}) },
          },
        }),
      ],
    });

    expect(mockDefineCronJob).toHaveBeenCalledWith('cronModule.dailyTask', {
      interval: 86400000,
      handler: expect.any(Function),
    });
    expect(mockStartCronJobs).toHaveBeenCalled();
  });

  test('does not define cron jobs when cron is disabled', async () => {
    await startApp({
      modules: [
        createTestModule({
          name: 'cronModule',
          cronJobs: {
            dailyTask: { interval: 86400000, handler: jest.fn(async () => {}) },
          },
        }),
      ],
    });

    expect(mockDefineCronJob).not.toHaveBeenCalled();
    expect(mockStartCronJobs).not.toHaveBeenCalled();
  });

  test('merges config schema from all modules without duplicates', async () => {
    await startApp({
      modules: [
        createTestModule({
          name: 'module1',
          configSchema: {
            apiKey: { type: 'string', default: '', isPublic: false },
          },
        }),
        createTestModule({
          name: 'module2',
          configSchema: {
            timeout: { type: 'number', default: 30, isPublic: false },
          },
        }),
      ],
    });

    expect(mockSetSchema).toHaveBeenCalledWith({
      'module1.apiKey': { type: 'string', default: '', isPublic: false },
      'module2.timeout': { type: 'number', default: 30, isPublic: false },
    });
  });

  test('connects to cloud backend when MODELENCE_SERVICE_ENDPOINT is set', async () => {
    process.env.MODELENCE_SERVICE_ENDPOINT = 'https://cloud.example.com';

    (mockConnectCloudBackend as jest.MockedFunction<any>).mockResolvedValue({
      configs: [{ key: 'test', type: 'string', value: 'value' }],
      environmentId: 'env-123',
      appAlias: 'test-app',
      environmentAlias: 'test-env',
      telemetry: { enabled: true },
    });

    await startApp({});

    expect(mockConnectCloudBackend).toHaveBeenCalledWith({
      configSchema: expect.any(Object),
      cronJobsMetadata: undefined,
      stores: expect.any(Array),
    });
    expect(mockLoadConfigs).toHaveBeenCalledWith([{ key: 'test', type: 'string', value: 'value' }]);
    expect(mockSetMetadata).toHaveBeenCalledWith({
      environmentId: 'env-123',
      appAlias: 'test-app',
      environmentAlias: 'test-env',
      telemetry: { enabled: true },
    });
    expect(mockInitMetrics).toHaveBeenCalled();
    expect(mockStartConfigSync).toHaveBeenCalled();
  });

  test('loads local configs when cloud backend is not configured', async () => {
    process.env.MONGODB_URI = 'mongodb://localhost:27017/test';
    process.env.MODELENCE_LOG_LEVEL = 'debug';

    await startApp({
      modules: [
        createTestModule({
          name: 'test',
          configSchema: {
            mongodbUri: { type: 'string', default: '', isPublic: false },
            'log.level': { type: 'string', default: 'info', isPublic: false },
          },
        }),
      ],
    });

    expect(mockConnectCloudBackend).not.toHaveBeenCalled();
    expect(mockLoadConfigs).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ key: '_system.mongodbUri' }),
        expect.objectContaining({ key: '_system.log.level', value: 'debug' }),
      ])
    );
    expect(mockInitMetrics).not.toHaveBeenCalled();
    expect(mockStartConfigSync).not.toHaveBeenCalled();
  });

  test('starts migrations when cron is enabled', async () => {
    process.env.MODELENCE_CRON_ENABLED = 'true';
    mockGetMongodbUri.mockReturnValue('mongodb://localhost:27017/test');

    const migrations: MigrationScript[] = [
      { version: 1, description: 'Test migration', handler: jest.fn(async () => {}) },
    ];

    await startApp({ migrations });

    expect(mockStartMigrations).toHaveBeenCalledWith(migrations);
  });

  test('does not start migrations when cron is disabled', async () => {
    mockGetMongodbUri.mockReturnValue('mongodb://localhost:27017/test');

    const migrations: MigrationScript[] = [
      { version: 1, description: 'Test migration', handler: jest.fn(async () => {}) },
    ];

    await startApp({ migrations });

    expect(mockStartMigrations).not.toHaveBeenCalled();
  });

  test('starts server with combined modules and channels', async () => {
    const channel1 = { name: 'channel1' } as any;
    const channel2 = { name: 'channel2' } as any;

    await startApp({
      modules: [
        createTestModule({ name: 'module1', channels: [channel1] }),
        createTestModule({ name: 'module2', channels: [channel2] }),
      ],
    });

    expect(mockStartServer).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        combinedModules: expect.any(Array),
        channels: [channel1, channel2],
      })
    );
  });
});
