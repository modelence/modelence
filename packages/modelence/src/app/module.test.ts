import { describe, test, expect, vi, beforeEach } from 'vitest';
import { Module } from './module';
import { getConfig as mockGetConfig } from '../config/server';
import { Store } from '../data/store';
import { ServerChannel } from '@/websocket/serverChannel';
import { RouteDefinition } from '../routes/types';
import { RateLimitRule } from '../rate-limit/types';
import { CronJobInputParams } from '../cron/types';

vi.mock('../config/server', () => ({
  getConfig: vi.fn(),
}));

describe('app/module', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('initializes with default values when only name is provided', () => {
    const mod = new Module('auth');

    expect(mod.name).toBe('auth');
    expect(mod.stores).toEqual([]);
    expect(mod.queries).toEqual({});
    expect(mod.mutations).toEqual({});
    expect(mod.routes).toEqual([]);
    expect(mod.cronJobs).toEqual({});
    expect(mod.configSchema).toEqual({});
    expect(mod.rateLimits).toEqual([]);
    expect(mod.channels).toEqual([]);
  });

  test('initializes with default values when an empty options object is provided', () => {
    const mod = new Module('empty', {});

    expect(mod.name).toBe('empty');
    expect(mod.stores).toEqual([]);
    expect(mod.queries).toEqual({});
    expect(mod.mutations).toEqual({});
    expect(mod.routes).toEqual([]);
    expect(mod.cronJobs).toEqual({});
    expect(mod.configSchema).toEqual({});
    expect(mod.rateLimits).toEqual([]);
    expect(mod.channels).toEqual([]);
  });

  test('stores all provided options accurately', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mockStore = { name: 'items' } as unknown as Store<any, any>;
    const mockQuery = vi.fn();
    const mockMutation = vi.fn();
    const mockRoute: RouteDefinition = {
      path: '/items',
      handlers: {
        get: vi.fn(),
      },
    };
    const mockCronJob: CronJobInputParams = {
      interval: 60,
      handler: vi.fn(),
    };
    const mockConfigSchema = {
      maxRetries: { type: 'number' as const, default: 3, isPublic: false },
      apiKey: { type: 'secret' as const, default: '', isPublic: false },
    };
    const mockRateLimit: RateLimitRule = {
      bucket: 'items',
      type: 'ip',
      limit: 100,
      window: 60_000,
    };
    const mockChannel = { name: 'updates' } as unknown as ServerChannel;

    const mod = new Module('itemsModule', {
      stores: [mockStore],
      queries: { getItems: mockQuery },
      mutations: { createItem: mockMutation },
      routes: [mockRoute],
      cronJobs: { cleanup: mockCronJob },
      configSchema: mockConfigSchema,
      rateLimits: [mockRateLimit],
      channels: [mockChannel],
    });

    expect(mod.name).toBe('itemsModule');
    expect(mod.stores).toEqual([mockStore]);
    expect(mod.queries).toEqual({ getItems: mockQuery });
    expect(mod.mutations).toEqual({ createItem: mockMutation });
    expect(mod.routes).toEqual([mockRoute]);
    expect(mod.cronJobs).toEqual({ cleanup: mockCronJob });
    expect(mod.configSchema).toEqual(mockConfigSchema);
    expect(mod.rateLimits).toEqual([mockRateLimit]);
    expect(mod.channels).toEqual([mockChannel]);
  });

  test('allows mutating rateLimits array', () => {
    const mod = new Module('rateLimited');
    expect(mod.rateLimits).toEqual([]);

    const newRule: RateLimitRule = {
      bucket: 'custom',
      type: 'ip',
      limit: 10,
      window: 1000,
    };
    mod.rateLimits.push(newRule);

    expect(mod.rateLimits).toHaveLength(1);
    expect(mod.rateLimits[0]).toBe(newRule);
  });

  test('retrieves typed configuration values using module namespace prefix', () => {
    vi.mocked(mockGetConfig).mockReturnValue('super-secret-key');

    const mod = new Module('payments', {
      configSchema: {
        apiKey: { type: 'secret', default: '', isPublic: false },
        maxAttempts: { type: 'number', default: 5, isPublic: false },
      },
    });

    const apiKey = mod.getConfig('apiKey');

    expect(mockGetConfig).toHaveBeenCalledTimes(1);
    expect(mockGetConfig).toHaveBeenCalledWith('payments.apiKey');
    expect(apiKey).toBe('super-secret-key');
  });

  test('delegates getConfig with different module names and config keys', () => {
    vi.mocked(mockGetConfig).mockReturnValue(42);

    const mod = new Module('analytics', {
      configSchema: {
        batchSize: { type: 'number', default: 50, isPublic: true },
      },
    });

    const batchSize = mod.getConfig('batchSize');

    expect(mockGetConfig).toHaveBeenCalledWith('analytics.batchSize');
    expect(batchSize).toBe(42);
  });
});
