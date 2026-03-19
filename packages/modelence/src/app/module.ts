import { ConfigSchema, ConfigParams, ValueType } from '../config/types';
import { getConfig as _getConfig } from '../config/server';
import { CronJobInputParams } from '../cron/types';
import { Store } from '../data/store';
import { RouteDefinition } from '../routes/types';
import { RateLimitRule } from '../rate-limit/types';
import { ServerChannel } from '@/websocket/serverChannel';

/** Array of Store instances that will be provisioned when the module is loaded */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Stores = Store<any, any>[];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyMethodShape = ((...args: any[]) => any) | { handler: (...args: any[]) => any };

/** Record of query methods that can be called from the client */
type Queries = Record<string, AnyMethodShape>;

/** Record of mutation methods that can be called from the client */
type Mutations = Record<string, AnyMethodShape>;

/**
 * The Module class is a core building block of a Modelence application that encapsulates related functionality.
 * Modules can contain stores, queries, mutations, routes, cron jobs and configurations.
 *
 * @category Module
 *
 * @example
 * ```ts
 * const todoModule = new Module('todo', {
 *   stores: [dbTodos],
 *   queries: {
 *     async getAll() {
 *       // Fetch and return all Todo items
 *     }
 *   },
 *   mutations: {
 *     async create({ title }, { user }) {
 *       // Create a new Todo item
 *     }
 *   }
 * });
 * ```
 */
export class Module<
  TName extends string = string,
  TSchema extends Record<string, ConfigParams> = ConfigSchema,
  TQueries extends Queries = Queries,
  TMutations extends Mutations = Mutations,
> {
  /** @internal */
  public readonly name: TName;

  /** @internal */
  public readonly stores: Stores;

  /** @internal */
  public readonly queries: TQueries;

  /** @internal */
  public readonly mutations: TMutations;

  /** @internal */
  public readonly routes: RouteDefinition[];

  /** @internal */
  public readonly cronJobs: Record<string, CronJobInputParams>;

  /** @internal */
  public readonly configSchema: TSchema;

  /** @internal */
  public readonly rateLimits: RateLimitRule[];

  /** @internal */
  public readonly channels: ServerChannel[];

  /**
   * Creates a new Module instance
   *
   * @param name - The unique name of the module.
   * This name is used to namespace queries, mutations,
   * cron jobs and configuration values with a prefix (e.g. "todo.create")
   *
   * @param options - Module configuration options
   */
  constructor(
    name: TName,
    {
      stores = [],
      queries = {} as TQueries,
      mutations = {} as TMutations,
      routes = [],
      cronJobs = {},
      configSchema = {} as TSchema,
      rateLimits = [],
      channels = [],
    }: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      stores?: Store<any, any>[];
      queries?: TQueries;
      mutations?: TMutations;
      routes?: RouteDefinition[];
      cronJobs?: Record<string, CronJobInputParams>;
      configSchema?: TSchema;
      rateLimits?: RateLimitRule[];
      channels?: ServerChannel[];
    } = {}
  ) {
    this.name = name;
    this.stores = stores;
    this.queries = queries;
    this.mutations = mutations;
    this.routes = routes;
    this.cronJobs = cronJobs;
    this.configSchema = configSchema;
    this.rateLimits = rateLimits;
    this.channels = channels;
  }

  /**
   * Retrieves a typed configuration value for this module.
   * The return type is inferred from the schema — no casts needed.
   *
   * @example
   * ```ts
   * const myModule = new Module('payments', {
   *   configSchema: {
   *     apiKey:     { type: 'secret', default: '', isPublic: false },
   *     maxRetries: { type: 'number', default: 3,  isPublic: false },
   *   },
   *   mutations: {
   *     async charge({ amount }) {
   *       const apiKey     = myModule.getConfig('apiKey');     // string
   *       const maxRetries = myModule.getConfig('maxRetries'); // number
   *     },
   *   },
   * });
   * ```
   */
  getConfig<K extends keyof TSchema & string>(key: K): ValueType<TSchema[K]['type']> {
    return _getConfig(`${this.name}.${key}`) as ValueType<TSchema[K]['type']>;
  }
}
