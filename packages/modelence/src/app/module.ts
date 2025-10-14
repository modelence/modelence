import { ConfigSchema } from '../config/types';
import { CronJobInputParams } from '../cron/types';
import { Store } from '../data/store';
import { MethodDefinition } from '../methods/types';
import { RouteDefinition } from '../routes/types';
import { RateLimitRule } from '../rate-limit/types';
import { ServerChannel } from '@/websocket/serverChannel';

/** Array of Store instances that will be provisioned when the module is loaded */
type Stores = Store<any, any>[];

/** Record of query methods that can be called from the client */
type Queries = Record<string, MethodDefinition<any>>;

/** Record of mutation methods that can be called from the client */
type Mutations = Record<string, MethodDefinition<any>>;

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
export class Module {
  /** @internal */
  public readonly name: string;

  /** @internal */
  public readonly stores: Stores;

  /** @internal */
  public readonly queries: Queries;

  /** @internal */
  public readonly mutations: Mutations;

  /** @internal */
  public readonly routes: RouteDefinition[];

  /** @internal */
  public readonly cronJobs: Record<string, CronJobInputParams>;

  /** @internal */
  public readonly configSchema: ConfigSchema;

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
    name: string,
    {
      stores = [],
      queries = {},
      mutations = {},
      routes = [],
      cronJobs = {},
      configSchema = {},
      rateLimits = [],
      channels = [],
    }: {
      stores?: Store<any, any>[];
      queries?: Queries;
      mutations?: Mutations;
      routes?: RouteDefinition[];
      cronJobs?: Record<string, CronJobInputParams>;
      configSchema?: ConfigSchema;
      rateLimits?: RateLimitRule[];
      channels?: ServerChannel[];
    }
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
}
