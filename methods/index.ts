import { requireServer } from '../utils';
import { startTransaction } from '../app/metrics';
import { Session, User } from '../auth/types';

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
  session: Session;
  user: User | null;
  clientInfo: ClientInfo;
  connectionInfo: ConnectionInfo;
};

type Args = Record<string, unknown>;

type Handler<T extends any[]> = (args: Args, context: Context) => Promise<any> | any;

type Method<T extends any[]> = {
  type: 'query' | 'effect';
  name: string;
  handler: Handler<T>;
};

const methods: Record<string, Method<any>> = {};

export function createQuery<T extends any[]>(name: string, handler: Handler<T>) {
  requireServer();

  if (name.toLowerCase().startsWith('_system.')) {
    throw new Error(`Method name cannot start with a reserved prefix: '_system.' (${name})`);
  }
  return _createMethodInternal('query', name, handler);
}

export function _createMethodInternal<T extends any[]>(type: 'query' | 'effect', name: string, handler: Handler<T>) {
  requireServer();

  if (methods[name]) {
    throw new Error(`Method with name '${name}' is already defined.`);
  }
  methods[name] = { type, name, handler };
}

export async function runMethod(name: string, args: Args, context: Context) {
  requireServer();

  const method = methods[name];
  if (!method) {
    throw new Error(`Method with name '${name}' is not defined.`);
  }
  const { type, handler } = method;

  const transaction = startTransaction('method', `method:${name}`, { type, args });
  const response = await handler(args, context);
  transaction.end();

  return response;
}
