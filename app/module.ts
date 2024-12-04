import { Store } from '../data/store';
import { Handler } from '../methods/types';

type Stores = Store<any>[];
type Queries = Record<string, Handler<any>>;
type Mutations = Record<string, Handler<any>>;

export class Module {
  public readonly name: string;
  public readonly stores: Stores;
  public readonly queries: Queries;
  public readonly mutations: Mutations;

  constructor(
    name: string,
    { stores, queries, mutations }: { stores?: Stores, queries?: Queries, mutations?: Mutations }
  ) {
    this.name = name;
    this.stores = stores ?? [];
    this.queries = queries ?? {};
    this.mutations = mutations ?? {};
  }
}
