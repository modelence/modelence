import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { MongoClient } from 'mongodb';

const mockConnect = jest.fn<() => Promise<void>>();
const mockCommand = jest.fn<(command: unknown) => Promise<unknown>>();
const mockDb = jest.fn<(dbName: string) => { command: typeof mockCommand }>(() => ({
  command: mockCommand,
}));
const mockGetConfig = jest.fn<(key: string) => unknown>();

// Mock MongoClient constructor
const MockMongoClient = jest.fn((uri: string, options?: unknown) => ({
  connect: mockConnect,
  db: mockDb,
  uri,
  options,
})) as unknown as typeof MongoClient;

jest.unstable_mockModule('mongodb', () => ({
  MongoClient: MockMongoClient,
}));

jest.unstable_mockModule('../config/server', () => ({
  getConfig: mockGetConfig,
}));

// Import after mocks are set up
const { getMongodbUri, getClient } = await import('./client');

describe('db/client', () => {
  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;

  beforeEach(() => {
    jest.clearAllMocks();
    // Reset the client state between tests by reimporting
    jest.resetModules();
    console.log = jest.fn();
    console.error = jest.fn();
  });

  afterEach(() => {
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
  });

  describe('getMongodbUri', () => {
    test('returns MongoDB URI from config when available', () => {
      mockGetConfig.mockReturnValue('mongodb://localhost:27017');

      const result = getMongodbUri();

      expect(mockGetConfig).toHaveBeenCalledWith('_system.mongodbUri');
      expect(result).toBe('mongodb://localhost:27017');
    });

    test('returns undefined when config is not set', () => {
      mockGetConfig.mockReturnValue(undefined);

      const result = getMongodbUri();

      expect(result).toBeUndefined();
    });

    test('converts non-string config values to string', () => {
      mockGetConfig.mockReturnValue(12345);

      const result = getMongodbUri();

      expect(result).toBe('12345');
    });

    test('returns undefined when config returns null', () => {
      mockGetConfig.mockReturnValue(null);

      const result = getMongodbUri();

      expect(result).toBeUndefined();
    });

    test('returns undefined when config returns empty string', () => {
      mockGetConfig.mockReturnValue('');

      const result = getMongodbUri();

      expect(result).toBeUndefined();
    });

    test('should be a function', () => {
      expect(typeof getMongodbUri).toBe('function');
    });
  });

  describe('connect', () => {
    test('successfully connects to MongoDB with valid URI', async () => {
      const { connect } = await import('./client');
      mockGetConfig.mockReturnValue('mongodb://localhost:27017');
      mockConnect.mockResolvedValue(undefined);
      mockCommand.mockResolvedValue({ ok: 1 });

      const client = await connect();

      expect(MockMongoClient).toHaveBeenCalledWith('mongodb://localhost:27017', {
        ignoreUndefined: true,
        maxPoolSize: 20,
      });
      expect(mockConnect).toHaveBeenCalledTimes(1);
      expect(mockDb).toHaveBeenCalledWith('admin');
      expect(mockCommand).toHaveBeenCalledWith({ ping: 1 });
      expect(console.log).toHaveBeenCalledWith(
        'Pinged your deployment. You successfully connected to MongoDB!'
      );
      expect(client).toBeDefined();
    });

    test('throws error when MongoDB URI is not set', async () => {
      const { connect } = await import('./client');
      mockGetConfig.mockReturnValue(undefined);

      await expect(connect()).rejects.toThrow('MongoDB URI is not set');
      expect(MockMongoClient).not.toHaveBeenCalled();
    });

    test('reuses existing client on subsequent calls', async () => {
      const { connect } = await import('./client');
      mockGetConfig.mockReturnValue('mongodb://localhost:27017');
      mockConnect.mockResolvedValue(undefined);
      mockCommand.mockResolvedValue({ ok: 1 });

      const client1 = await connect();
      const client2 = await connect();

      expect(client1).toBe(client2);
      expect(MockMongoClient).toHaveBeenCalledTimes(1);
      expect(mockConnect).toHaveBeenCalledTimes(1);
    });

    test('handles connection failure and logs error', async () => {
      const { connect } = await import('./client');
      mockGetConfig.mockReturnValue('mongodb://invalid:27017');
      const connectionError = new Error('Failed to connect');
      mockConnect.mockRejectedValue(connectionError);

      await expect(connect()).rejects.toThrow('Failed to connect');
      expect(console.error).toHaveBeenCalledWith(connectionError);
    });

    test('resets client to null on connection failure', async () => {
      const { connect, getClient } = await import('./client');
      mockGetConfig.mockReturnValue('mongodb://invalid:27017');
      mockConnect.mockRejectedValue(new Error('Connection failed'));

      await expect(connect()).rejects.toThrow('Connection failed');

      const client = getClient();
      expect(client).toBeNull();
    });

    test('handles ping failure after connection', async () => {
      const { connect } = await import('./client');
      mockGetConfig.mockReturnValue('mongodb://localhost:27017');
      mockConnect.mockResolvedValue(undefined);
      const pingError = new Error('Ping failed');
      mockCommand.mockRejectedValue(pingError);

      await expect(connect()).rejects.toThrow('Ping failed');
      expect(console.error).toHaveBeenCalledWith(pingError);
    });

    test('uses maxPoolSize of 20 in client options', async () => {
      const { connect } = await import('./client');
      mockGetConfig.mockReturnValue('mongodb://localhost:27017');
      mockConnect.mockResolvedValue(undefined);
      mockCommand.mockResolvedValue({ ok: 1 });

      await connect();

      expect(MockMongoClient).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          maxPoolSize: 20,
        })
      );
    });

    test('connects to admin database for ping command', async () => {
      const { connect } = await import('./client');
      mockGetConfig.mockReturnValue('mongodb://localhost:27017');
      mockConnect.mockResolvedValue(undefined);
      mockCommand.mockResolvedValue({ ok: 1 });

      await connect();

      expect(mockDb).toHaveBeenCalledWith('admin');
      expect(mockCommand).toHaveBeenCalledWith({ ping: 1 });
    });

    test('can retry connection after previous failure', async () => {
      const { connect } = await import('./client');
      mockGetConfig.mockReturnValue('mongodb://localhost:27017');

      // First attempt fails
      mockConnect.mockRejectedValueOnce(new Error('First failure'));
      await expect(connect()).rejects.toThrow('First failure');

      // Second attempt succeeds
      mockConnect.mockResolvedValueOnce(undefined);
      mockCommand.mockResolvedValue({ ok: 1 });
      const client = await connect();

      expect(client).toBeDefined();
      expect(MockMongoClient).toHaveBeenCalledTimes(2);
    });
  });

  describe('getClient', () => {
    test('returns null when no client is connected', async () => {
      const { getClient } = await import('./client');

      const client = getClient();

      expect(client).toBeNull();
    });

    test('should return null initially', () => {
      expect(getClient()).toBeNull();
    });

    test('should be a function', () => {
      expect(typeof getClient).toBe('function');
    });

    test('returns client after successful connection', async () => {
      const { connect, getClient } = await import('./client');
      mockGetConfig.mockReturnValue('mongodb://localhost:27017');
      mockConnect.mockResolvedValue(undefined);
      mockCommand.mockResolvedValue({ ok: 1 });

      await connect();
      const client = getClient();

      expect(client).not.toBeNull();
      expect(client).toBeDefined();
    });

    test('returns same client instance as connect()', async () => {
      const { connect, getClient } = await import('./client');
      mockGetConfig.mockReturnValue('mongodb://localhost:27017');
      mockConnect.mockResolvedValue(undefined);
      mockCommand.mockResolvedValue({ ok: 1 });

      const connectedClient = await connect();
      const retrievedClient = getClient();

      expect(retrievedClient).toBe(connectedClient);
    });
  });

  describe('integration scenarios', () => {
    test('typical flow: getUri -> connect -> getClient', async () => {
      const { connect, getMongodbUri, getClient } = await import('./client');
      mockGetConfig.mockReturnValue('mongodb://localhost:27017');
      mockConnect.mockResolvedValue(undefined);
      mockCommand.mockResolvedValue({ ok: 1 });

      // Get URI
      const uri = getMongodbUri();
      expect(uri).toBe('mongodb://localhost:27017');

      // Connect
      const connectedClient = await connect();
      expect(connectedClient).toBeDefined();

      // Get client
      const retrievedClient = getClient();
      expect(retrievedClient).toBe(connectedClient);
    });

    test('connect is idempotent across multiple calls', async () => {
      const { connect } = await import('./client');
      mockGetConfig.mockReturnValue('mongodb://localhost:27017');
      mockConnect.mockResolvedValue(undefined);
      mockCommand.mockResolvedValue({ ok: 1 });

      const client1 = await connect();
      const client2 = await connect();
      const client3 = await connect();

      expect(client1).toBe(client2);
      expect(client2).toBe(client3);
      expect(MockMongoClient).toHaveBeenCalledTimes(1);
      expect(mockConnect).toHaveBeenCalledTimes(1);
      expect(mockCommand).toHaveBeenCalledTimes(1);
    });

    test('handles multiple URI configurations', async () => {
      mockConnect.mockResolvedValue(undefined);
      mockCommand.mockResolvedValue({ ok: 1 });

      // Test with different URI formats
      const uris = [
        'mongodb://localhost:27017',
        'mongodb://user:pass@localhost:27017',
        'mongodb+srv://cluster.mongodb.net',
      ];

      for (const uri of uris) {
        const { connect } = await import('./client');
        mockGetConfig.mockReturnValue(uri);

        await connect();

        expect(MockMongoClient).toHaveBeenCalledWith(uri, expect.any(Object));
        jest.resetModules();
      }
    });
  });
});
