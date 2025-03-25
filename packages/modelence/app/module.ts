import { ConfigSchema } from '../config/types';
import { CronJobInputParams } from '../cron/types';
import { Store } from '../data/store';
import { MethodDefinition } from '../methods/types';
import { RouteDefinition } from '../routes/types';

type Stores = Store<any, any>[];
type Queries = Record<string, MethodDefinition<any>>;
type Mutations = Record<string, MethodDefinition<any>>;

export class Module {
  public readonly name: string;
  public readonly stores: Stores;
  public readonly queries: Queries;
  public readonly mutations: Mutations;
  public readonly routes: RouteDefinition[];
  public readonly cronJobs: Record<string, CronJobInputParams>;
  public readonly configSchema: ConfigSchema;

  constructor(
    name: string,
    { 
      stores = [], 
      queries = {}, 
      mutations = {},
      routes = [],
      cronJobs = {},
      configSchema = {}
    }: { 
      stores?: Stores, 
      queries?: Queries, 
      mutations?: Mutations,
      routes?: RouteDefinition[],
      cronJobs?: Record<string, CronJobInputParams>,
      configSchema?: ConfigSchema
    }
  ) {
    this.name = name;
    this.stores = stores;
    this.queries = queries;
    this.mutations = mutations;
    this.routes = routes;
    this.cronJobs = cronJobs;
    this.configSchema = configSchema;
  }
}
