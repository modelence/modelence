import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Mock } from 'vitest';
import type { Module } from './module';
import type { MigrationScript } from '../migration';
import type { ModelSchema } from '../data/types';
import type { Store } from '../data/store';
import type { RateLimitRule } from '../rate-limit/types';
import type { AuthRateLimitsConfig } from './authConfig';
import { ServerChannel } from '@/websocket/serverChannel';
import type { WebsocketServerProvider } from '@/websocket/types';

// Mock external dependencies
const mockDotenvConfig = vi.fn();
const mockConnect = vi.fn();
const mockGetMongodbUri = vi.fn<() => string>();
const mockGetClient = vi.fn();
const mockStartServer = vi.fn();
const mockSetSchema = vi.fn();
const mockLoadConfigs = vi.fn();
const mockInitRoles = vi.fn();
const mockInitRateLimits = vi.fn();
const mockSetEmailConfig = vi.fn();
const mockSetAuthConfig = vi.fn();
const mockSetWebsocketConfig = vi.fn();
const mockMarkAppStarted = vi.fn();
const mockSetMetadata = vi.fn();
const mockConnectCloudBackend = vi.fn<
  (params: unknown) => Promise<{
    configs: Array<{ key: string; type: string; value: unknown }>;
    environmentId: string;
    appAlias: string;
    environmentAlias: string;
    telemetry: Record<string, unknown>;
  }>
>();
const mockInitMetrics = vi.fn();
const mockStartConfigSync = vi.fn();
const mockLoadRemoteConfigs = vi.fn();
const mockRunMigrations = vi.fn();
const mockStartMigrations = vi.fn();
const mockStartCronJobs = vi.fn<() => Promise<void>>();
const mockRegisterNewCronJobs = vi.fn<() => Promise<void>>();
const mockDefineCronJob = vi.fn();
const mockGetCronJobsMetadata = vi.fn();
const mockCreateQuery = vi.fn();
const mockCreateMutation = vi.fn();
const mockCreateSystemQuery = vi.fn();
const mockCreateSystemMutation = vi.fn();
const mockAcquireLock = vi.fn<
  (
    resource: string,
    options?: {
      lockDuration?: number;
      heartbeat?: boolean;
    }
  ) => Promise<boolean>
>();
const mockReleaseLock = vi.fn<(resource: string) => Promise<boolean>>();
const mockSocketioServer = { listen: vi.fn() };
const expectedMigrationsLockOptions = {
  lockDuration: 30_000,
  heartbeat: true,
};

const mockResolveStores =
  vi.fn<(stores: unknown[]) => { storesToInit: unknown[]; effectiveStores: unknown[] }>();

const mockBuildAuthRateLimits = vi.fn<(config?: AuthRateLimitsConfig) => RateLimitRule[]>(() => []);
const mockUserModule = {
  name: '_system.user',
  queries: {},
  mutations: {},
  stores: [],
  channels: [],
  rateLimits: [] as RateLimitRule[],
  cronJobs: {},
  configSchema: {},
};

vi.doMock('dotenv', () => ({
  default: { config: mockDotenvConfig },
}));

vi.doMock('../db/client', () => ({
  connect: mockConnect,
  getMongodbUri: mockGetMongodbUri,
  getClient: mockGetClient,
}));

vi.doMock('./server', () => ({
  startServer: mockStartServer,
}));

vi.doMock('../config/server', () => ({
  setSchema: mockSetSchema,
  loadConfigs: mockLoadConfigs,
  getConfig: vi.fn(),
}));

vi.doMock('../auth/role', () => ({
  initRoles: mockInitRoles,
}));

vi.doMock('../rate-limit/rules', () => ({
  initRateLimits: mockInitRateLimits,
}));

vi.doMock('./emailConfig', () => ({
  setEmailConfig: mockSetEmailConfig,
}));

vi.doMock('./authConfig', () => ({
  setAuthConfig: mockSetAuthConfig,
}));

vi.doMock('./websocketConfig', () => ({
  setWebsocketConfig: mockSetWebsocketConfig,
}));

vi.doMock('./state', () => ({
  markAppStarted: mockMarkAppStarted,
  setMetadata: mockSetMetadata,
}));

vi.doMock('./backendApi', () => ({
  connectCloudBackend: mockConnectCloudBackend,
  callCloudApi: vi.fn(),
}));

vi.doMock('./metrics', () => ({
  initMetrics: mockInitMetrics,
}));

vi.doMock('../config/sync', () => ({
  startConfigSync: mockStartConfigSync,
  loadRemoteConfigs: mockLoadRemoteConfigs,
}));

vi.doMock('../migration', () => ({
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
  runMigrations: mockRunMigrations,
  startMigrations: mockStartMigrations,
}));

vi.doMock('../cron/jobs', () => ({
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
  registerNewCronJobs: mockRegisterNewCronJobs,
}));

vi.doMock('../methods', () => ({
  createQuery: mockCreateQuery,
  createMutation: mockCreateMutation,
  _createSystemQuery: mockCreateSystemQuery,
  _createSystemMutation: mockCreateSystemMutation,
}));

vi.doMock('@/websocket/socketio/server', () => ({
  default: mockSocketioServer,
}));

vi.doMock('../auth/user', () => ({
  buildAuthRateLimits: mockBuildAuthRateLimits,
  default: mockUserModule,
}));

vi.doMock('../auth/session', () => ({
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

vi.doMock('../rate-limit', () => ({
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

vi.doMock('../system', () => ({
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

vi.doMock('../lock', () => ({
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
  acquireLock: mockAcquireLock,
  releaseLock: mockReleaseLock,
}));

vi.doMock('../viteServer', () => ({
  viteServer: { listen: vi.fn() },
}));

vi.doMock('../data/resolveStores', () => ({
  resolveStores: mockResolveStores,
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

type MinimalStore = Pick<
  Store<ModelSchema, Record<string, never>>,
  'init' | 'createIndexes' | 'getName' | 'getIndexCreationMode'
>;

const createStoreMock = (
  name = 'testStore',
  indexCreationMode: 'blocking' | 'background' = 'background'
): MinimalStore => ({
  init: vi.fn() as MinimalStore['init'],
  createIndexes: vi.fn() as MinimalStore['createIndexes'],
  getName: vi.fn(() => name) as MinimalStore['getName'],
  getIndexCreationMode: vi.fn(() => indexCreationMode) as MinimalStore['getIndexCreationMode'],
});

describe('app/index', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAcquireLock.mockResolvedValue(true);
    mockReleaseLock.mockResolvedValue(true);
    mockRunMigrations.mockResolvedValue(undefined as never);
    mockGetMongodbUri.mockReturnValue('');
    mockConnectCloudBackend.mockResolvedValue({
      configs: [],
      environmentId: 'env-123',
      appAlias: 'test-app',
      environmentAlias: 'test-env',
      telemetry: {},
    });
    mockStartCronJobs.mockResolvedValue(undefined);
    mockRegisterNewCronJobs.mockResolvedValue(undefined);
    // Default resolveStores: each store is its own effective store
    mockResolveStores.mockImplementation((stores: unknown[]) => {
      const unique = [...new Set(stores)] as MinimalStore[];
      return { storesToInit: unique, effectiveStores: unique };
    });
    process.env.MODELENCE_TRACKING_ENABLED = 'false';
    delete process.env.MODELENCE_SERVICE_ENDPOINT;
    delete process.env.MONGODB_URI;
    delete process.env.MODELENCE_SITE_URL;
  });

  afterEach(() => {
    delete process.env.MODELENCE_TRACKING_ENABLED;
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
    const auth = { onAfterLogin: vi.fn(async () => {}) };
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
    const customProvider: WebsocketServerProvider = {
      init: vi.fn(async () => {}),
      broadcast: vi.fn(),
    };
    await startApp({ websocket: { provider: customProvider } });

    expect(mockSetWebsocketConfig).toHaveBeenCalledWith({
      provider: customProvider,
    });
  });

  test('connects to database when mongodb uri is provided', async () => {
    mockGetMongodbUri.mockReturnValue('mongodb://localhost:27017/test');
    const mockClient = { db: vi.fn() };
    mockGetClient.mockReturnValue(mockClient);

    const mockStore = createStoreMock('testStore', 'blocking');

    await startApp({
      modules: [
        createTestModule({
          stores: [mockStore as unknown as Store<ModelSchema, Record<string, never>>],
        }),
      ],
    });

    expect(mockConnect).toHaveBeenCalled();
    expect(mockStore.init).toHaveBeenCalledWith(
      expect.objectContaining({ db: expect.any(Function) })
    );
    expect(mockAcquireLock).toHaveBeenCalledWith('migrations', expectedMigrationsLockOptions);
    expect(mockStore.createIndexes).toHaveBeenCalledWith('full');
    expect(mockRunMigrations).toHaveBeenCalledWith([], { lockMode: 'skip' });
    await Promise.resolve();
    expect(mockReleaseLock).toHaveBeenCalledWith('migrations');
  });

  test('skips index creation when index lock is not acquired', async () => {
    mockGetMongodbUri.mockReturnValue('mongodb://localhost:27017/test');
    mockGetClient.mockReturnValue({ db: vi.fn() });
    mockAcquireLock.mockResolvedValue(false);

    const mockStore = createStoreMock('testStore', 'blocking');

    await startApp({
      modules: [
        createTestModule({
          stores: [mockStore as unknown as Store<ModelSchema, Record<string, never>>],
        }),
      ],
    });

    expect(mockAcquireLock).toHaveBeenCalledWith('migrations', expectedMigrationsLockOptions);
    expect(mockStore.createIndexes).not.toHaveBeenCalled();
    expect(mockRunMigrations).not.toHaveBeenCalled();
    expect(mockReleaseLock).not.toHaveBeenCalled();
  });

  test('does not connect to database when mongodb uri is not provided', async () => {
    mockGetMongodbUri.mockReturnValue('');

    await startApp({});

    expect(mockConnect).not.toHaveBeenCalled();
  });

  test('initializes custom module methods', async () => {
    const queryHandler = vi.fn();
    const mutationHandler = vi.fn();

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
    const store1 = createStoreMock();
    const store2 = createStoreMock();

    mockGetMongodbUri.mockReturnValue('mongodb://localhost:27017/test');
    mockGetClient.mockReturnValue({ db: vi.fn() });

    await startApp({
      modules: [
        createTestModule({
          name: 'module1',
          stores: [store1 as unknown as Store<ModelSchema, Record<string, never>>],
        }),
        createTestModule({
          name: 'module2',
          stores: [store2 as unknown as Store<ModelSchema, Record<string, never>>],
        }),
      ],
    });

    expect(store1.init).toHaveBeenCalled();
    expect(store2.init).toHaveBeenCalled();
  });

  test('collects rate limits from modules and initializes them', async () => {
    const rateLimit1: RateLimitRule = { bucket: 'limit1', type: 'user', window: 60000, limit: 100 };
    const rateLimit2: RateLimitRule = { bucket: 'limit2', type: 'user', window: 60000, limit: 200 };

    await startApp({
      modules: [
        createTestModule({ name: 'module1', rateLimits: [rateLimit1] }),
        createTestModule({ name: 'module2', rateLimits: [rateLimit2] }),
      ],
    });

    expect(mockInitRateLimits).toHaveBeenCalledWith([rateLimit1, rateLimit2]);
  });

  test('writes auth rate limit overrides onto the user module before collection', async () => {
    const authRules: RateLimitRule[] = [
      { bucket: 'signup', type: 'ip', window: 900_000, limit: 5 },
    ];
    mockBuildAuthRateLimits.mockReturnValueOnce(authRules);

    await startApp({
      auth: {
        rateLimits: {
          signup: [{ type: 'ip', window: 900_000, limit: 5 }],
        },
      },
    });

    // The builder receives the user-supplied overrides
    expect(mockBuildAuthRateLimits).toHaveBeenCalledWith({
      signup: [{ type: 'ip', window: 900_000, limit: 5 }],
    });

    // Effective limits land on the user module (so Modelence Cloud can read them)
    expect(mockUserModule.rateLimits).toEqual(authRules);

    // And feed into initRateLimits via getRateLimits()
    expect(mockInitRateLimits).toHaveBeenCalledWith(expect.arrayContaining(authRules));
  });

  test('defines cron jobs from modules', async () => {
    await startApp({
      modules: [
        createTestModule({
          name: 'cronModule',
          cronJobs: {
            dailyTask: { interval: 86400000, handler: vi.fn(async () => {}) },
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

    mockConnectCloudBackend.mockResolvedValue({
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
      roles: {},
    });
    expect(mockLoadRemoteConfigs).toHaveBeenCalledWith([
      { key: 'test', type: 'string', value: 'value' },
    ]);
    expect(mockSetMetadata).toHaveBeenCalledWith({
      environmentId: 'env-123',
      appAlias: 'test-app',
      environmentAlias: 'test-env',
      telemetry: { enabled: true },
    });
    expect(mockInitMetrics).toHaveBeenCalled();
    expect(mockStartConfigSync).toHaveBeenCalled();
  });

  test('passes cloud configs to loadRemoteConfigs when remote backend is enabled', async () => {
    process.env.MODELENCE_SERVICE_ENDPOINT = 'https://cloud.example.com';

    mockConnectCloudBackend.mockResolvedValue({
      configs: [
        { key: '_system.site.url', type: 'string', value: 'https://cloud.example.com' },
        { key: '_system.mongodbUri', type: 'string', value: 'mongodb://cloud:27017/app' },
      ],
      environmentId: 'env-123',
      appAlias: 'test-app',
      environmentAlias: 'test-env',
      telemetry: { enabled: true },
    });

    await startApp({});

    expect(mockLoadRemoteConfigs).toHaveBeenCalledWith([
      { key: '_system.site.url', type: 'string', value: 'https://cloud.example.com' },
      { key: '_system.mongodbUri', type: 'string', value: 'mongodb://cloud:27017/app' },
    ]);
  });

  test('passes roles to cloud backend', async () => {
    process.env.MODELENCE_SERVICE_ENDPOINT = 'https://cloud.example.com';

    const roles = {
      admin: { description: 'Full access', permissions: ['manage_users'] },
      editor: { permissions: ['edit_content'] },
    };

    await startApp({ roles });

    expect(mockConnectCloudBackend).toHaveBeenCalledWith(expect.objectContaining({ roles }));
  });

  test('loads local configs when cloud backend is not configured', async () => {
    process.env.MONGODB_URI = 'mongodb://localhost:27017/test';
    process.env.MODELENCE_SITE_URL = 'https://example.com';

    await startApp({
      modules: [createTestModule()],
    });

    expect(mockConnectCloudBackend).not.toHaveBeenCalled();
    expect(mockLoadConfigs).toHaveBeenCalledWith([
      expect.objectContaining({
        key: '_system.mongodbUri',
        value: 'mongodb://localhost:27017/test',
      }),
      expect.objectContaining({ key: '_system.site.url', value: 'https://example.com' }),
    ]);
    expect(mockInitMetrics).not.toHaveBeenCalled();
    expect(mockStartConfigSync).not.toHaveBeenCalled();
  });

  test('starts migrations when mongodb is connected', async () => {
    mockGetMongodbUri.mockReturnValue('mongodb://localhost:27017/test');

    const migrations: MigrationScript[] = [
      { version: 1, description: 'Test migration', handler: vi.fn(async () => {}) },
    ];

    await startApp({ migrations });

    expect(mockRunMigrations).toHaveBeenCalledWith(migrations, { lockMode: 'skip' });
  });

  test('starts migrations after blocking + drop-only index phases and before cron jobs', async () => {
    mockGetMongodbUri.mockReturnValue('mongodb://localhost:27017/test');
    mockGetClient.mockReturnValue({ db: vi.fn() });

    let resolveBlockingIndexes: () => void = () => undefined;
    const blockingIndexesPromise = new Promise<void>((resolve) => {
      resolveBlockingIndexes = resolve;
    });
    let resolveDropOnlyIndexes: () => void = () => undefined;
    const dropOnlyIndexesPromise = new Promise<void>((resolve) => {
      resolveDropOnlyIndexes = resolve;
    });
    let resolveBackgroundCreateIndexes: () => void = () => undefined;
    const backgroundCreateIndexesPromise = new Promise<void>((resolve) => {
      resolveBackgroundCreateIndexes = resolve;
    });
    const lockStore: MinimalStore = {
      init: vi.fn() as MinimalStore['init'],
      createIndexes: vi.fn(async () => blockingIndexesPromise) as MinimalStore['createIndexes'],
      getName: vi.fn(() => '_modelenceLocks') as MinimalStore['getName'],
      getIndexCreationMode: vi.fn(() => 'blocking') as MinimalStore['getIndexCreationMode'],
    };
    const otherStore: MinimalStore = {
      init: vi.fn() as MinimalStore['init'],
      createIndexes: vi.fn(async (mode?: 'full' | 'drop-only' | 'create-only') => {
        if (mode === 'drop-only') {
          await dropOnlyIndexesPromise;
        }

        if (mode === 'create-only') {
          await backgroundCreateIndexesPromise;
        }
      }) as MinimalStore['createIndexes'],
      getName: vi.fn(() => 'testCollection') as MinimalStore['getName'],
      getIndexCreationMode: vi.fn(() => 'background') as MinimalStore['getIndexCreationMode'],
    };

    // resolveStores: lockStore is blocking effective, otherStore is background effective
    mockResolveStores.mockReturnValue({
      storesToInit: [lockStore, otherStore],
      effectiveStores: [lockStore, otherStore],
    });

    const migrations: MigrationScript[] = [
      { version: 1, description: 'Test migration', handler: vi.fn(async () => {}) },
    ];

    const startPromise = startApp({
      migrations,
      modules: [
        createTestModule({
          stores: [
            lockStore as unknown as Store<ModelSchema, Record<string, never>>,
            otherStore as unknown as Store<ModelSchema, Record<string, never>>,
          ],
        }),
      ],
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(mockAcquireLock).toHaveBeenCalledTimes(1);
    expect(mockAcquireLock).toHaveBeenCalledWith('migrations', expectedMigrationsLockOptions);
    expect(lockStore.createIndexes).toHaveBeenCalledWith('full');
    expect(otherStore.createIndexes).not.toHaveBeenCalled();
    expect(mockRunMigrations).not.toHaveBeenCalled();
    expect(mockStartCronJobs).not.toHaveBeenCalled();

    resolveBlockingIndexes();
    await Promise.resolve();
    await Promise.resolve();

    resolveDropOnlyIndexes();
    await startPromise;
    await Promise.resolve();
    await Promise.resolve();

    expect(otherStore.createIndexes).toHaveBeenCalledWith('drop-only');
    expect(mockRunMigrations).toHaveBeenCalledWith(migrations, { lockMode: 'skip' });
    expect(mockRunMigrations.mock.invocationCallOrder[0]).toBeGreaterThan(
      (otherStore.createIndexes as Mock).mock.invocationCallOrder[0]
    );
    expect(otherStore.createIndexes).toHaveBeenCalledWith('create-only');
    expect(mockReleaseLock).not.toHaveBeenCalled();
    expect(mockStartCronJobs).toHaveBeenCalledTimes(1);

    resolveBackgroundCreateIndexes();
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockReleaseLock).toHaveBeenCalledTimes(1);
    expect(mockReleaseLock).toHaveBeenCalledWith('migrations');
  });

  test('warns and continues startup when blocking index creation fails', async () => {
    mockGetMongodbUri.mockReturnValue('mongodb://localhost:27017/test');
    mockGetClient.mockReturnValue({ db: vi.fn() });

    const indexCreationError = new Error('index creation failed');
    const lockStore = createStoreMock('_modelenceLocks', 'blocking');
    (lockStore.createIndexes as Mock).mockRejectedValue(indexCreationError as never);
    const otherStore = createStoreMock('testCollection');

    mockResolveStores.mockReturnValue({
      storesToInit: [lockStore, otherStore],
      effectiveStores: [lockStore, otherStore],
    });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const migrations: MigrationScript[] = [
      { version: 1, description: 'Test migration', handler: vi.fn(async () => {}) },
    ];

    await expect(
      startApp({
        migrations,
        modules: [
          createTestModule({
            stores: [
              lockStore as unknown as Store<ModelSchema, Record<string, never>>,
              otherStore as unknown as Store<ModelSchema, Record<string, never>>,
            ],
          }),
        ],
      })
    ).resolves.toBeUndefined();

    expect(lockStore.createIndexes).toHaveBeenCalledWith('full');
    expect(warnSpy).toHaveBeenCalledWith(
      "Failed to create indexes for store '_modelenceLocks'. Continuing startup.",
      indexCreationError
    );
    expect(mockRunMigrations).toHaveBeenCalledWith(migrations, { lockMode: 'skip' });
    expect(mockStartCronJobs).toHaveBeenCalledTimes(1);

    warnSpy.mockRestore();
  });

  test('warns and continues startup when critical index creation fails', async () => {
    mockGetMongodbUri.mockReturnValue('mongodb://localhost:27017/test');
    mockGetClient.mockReturnValue({ db: vi.fn() });

    const criticalError = new Error('critical index failed');
    const criticalStore = createStoreMock('_modelenceLocks', 'blocking');
    (criticalStore.createIndexes as Mock).mockRejectedValue(criticalError as never);
    const otherStore = createStoreMock('testCollection');

    mockResolveStores.mockReturnValue({
      storesToInit: [criticalStore, otherStore],
      effectiveStores: [criticalStore, otherStore],
    });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const migrations: MigrationScript[] = [
      { version: 1, description: 'Test migration', handler: vi.fn(async () => {}) },
    ];

    await expect(
      startApp({
        migrations,
        modules: [
          createTestModule({
            stores: [
              criticalStore as unknown as Store<ModelSchema, Record<string, never>>,
              otherStore as unknown as Store<ModelSchema, Record<string, never>>,
            ],
          }),
        ],
      })
    ).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalledWith(
      "Failed to create indexes for store '_modelenceLocks'. Continuing startup.",
      criticalError
    );
    expect(mockRunMigrations).toHaveBeenCalledWith(migrations, { lockMode: 'skip' });
    expect(mockStartCronJobs).toHaveBeenCalledTimes(1);

    warnSpy.mockRestore();
  });

  test('releases index lock when createIndexesWithLock throws unexpectedly', async () => {
    mockGetMongodbUri.mockReturnValue('mongodb://localhost:27017/test');
    mockGetClient.mockReturnValue({ db: vi.fn() });

    const unexpectedError = new Error('unexpected index path error');
    const brokenStore = createStoreMock('brokenStore', 'blocking');
    // Make getIndexCreationMode throw to simulate an unexpected error
    // inside createIndexesWithLock's filter logic.
    (brokenStore.getIndexCreationMode as Mock).mockImplementation(() => {
      throw unexpectedError;
    });

    mockResolveStores.mockReturnValue({
      storesToInit: [brokenStore],
      effectiveStores: [brokenStore],
    });

    await expect(
      startApp({
        modules: [
          createTestModule({
            stores: [brokenStore as unknown as Store<ModelSchema, Record<string, never>>],
          }),
        ],
      })
    ).rejects.toThrow('unexpected index path error');

    expect(mockAcquireLock).toHaveBeenCalledWith('migrations', expectedMigrationsLockOptions);
    expect(mockReleaseLock).toHaveBeenCalledTimes(1);
    expect(mockReleaseLock).toHaveBeenCalledWith('migrations');
  });

  test('registerNewCronJobs is called after createIndexesAndMigrationsWithLock when mongodb is connected', async () => {
    mockGetMongodbUri.mockReturnValue('mongodb://localhost:27017/test');
    mockGetClient.mockReturnValue({ db: vi.fn() });

    await startApp({});
    // Flush the micro-task queue so the fire-and-forgotten
    // backgroundIndexCreationPromise (which calls registerNewCronJobs) settles.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockRegisterNewCronJobs).toHaveBeenCalledTimes(1);
    // Verify it runs after the migrations lock is acquired
    expect(mockAcquireLock.mock.invocationCallOrder[0]).toBeLessThan(
      mockRegisterNewCronJobs.mock.invocationCallOrder[0]
    );
  });

  test('registerNewCronJobs failure is logged but does not crash startApp', async () => {
    mockGetMongodbUri.mockReturnValue('mongodb://localhost:27017/test');
    mockGetClient.mockReturnValue({ db: vi.fn() });

    const cronError = new Error('cron registration failed');
    mockRegisterNewCronJobs.mockRejectedValue(cronError);

    // registerNewCronJobs runs inside the fire-and-forgotten backgroundIndexCreationPromise;
    // its rejection is caught and logged by Promise.allSettled, so startApp itself resolves.
    await expect(startApp({})).resolves.toBeUndefined();
    // Flush the micro-task queue so the background promise settles.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockRegisterNewCronJobs).toHaveBeenCalledTimes(1);
  });

  test('starts server with combined modules and channels', async () => {
    const channel1 = new ServerChannel('channel1');
    const channel2 = new ServerChannel('channel2');

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
