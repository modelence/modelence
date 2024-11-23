import { requireServer } from '../utils';
import { startTransaction } from '../app/metrics';

type ClientInfo = {
  screenWidth: number;
  screenHeight: number;
  windowWidth: number;
  windowHeight: number;
  pixelRatio: number;
  orientation: string | null;
};

type ConnectionInfo = {
  ip?: string;
  userAgent?: string;
  acceptLanguage?: string;
  referrer?: string;
};

type Context = {
  authToken: string | null;
  clientInfo: ClientInfo;
  connectionInfo: ConnectionInfo;
};

type Args = Record<string, unknown>;

type Handler<T extends any[]> = (args: Args, context: Context) => Promise<any> | any;

type Loader<T extends any[]> = {
  name: string;
  handler: Handler<T>;
};

const loaders: Record<string, Loader<any>> = {};

export function createLoader<T extends any[]>(name: string, handler: Handler<T>) {
  requireServer();

  if (name.toLowerCase().startsWith('_system.')) {
    throw new Error(`Loader name cannot start with a reserved prefix: '_system.' (${name})`);
  }
  return _createLoaderInternal(name, handler);
}

export function _createLoaderInternal<T extends any[]>(name: string, handler: Handler<T>) {
  requireServer();

  if (loaders[name]) {
    throw new Error(`Loader with name '${name}' is already defined.`);
  }
  loaders[name] = { name, handler };
}

export async function runLoader(name: string, args: Args, context: Context) {
  requireServer();

  const loader = loaders[name];
  if (!loader) {
    throw new Error(`Loader with name '${name}' is not defined.`);
  }

  const transaction = startTransaction('loader', `loader:${name}`, { args });
  const response = await loader.handler(args, context);
  transaction.end();

  return response;
}
