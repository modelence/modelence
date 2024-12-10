import { Store } from '../data/store';
import { Handler } from '../methods/types';
import { RouteDefinition } from '../routes/types';

type Stores = Store<any>[];
type Queries = Record<string, Handler<any>>;
type Mutations = Record<string, Handler<any>>;

export class Module {
  public readonly name: string;
  public readonly stores: Stores;
  public readonly queries: Queries;
  public readonly mutations: Mutations;
  public readonly routes: RouteDefinition[];

  constructor(
    name: string,
    { 
      stores = [], 
      queries = {}, 
      mutations = {},
      routes = []
    }: { 
      stores?: Stores, 
      queries?: Queries, 
      mutations?: Mutations,
      routes?: RouteDefinition[]
    }
  ) {
    this.name = name;
    this.stores = stores;
    this.queries = queries;
    this.mutations = mutations;
    this.routes = routes;
  }
}
