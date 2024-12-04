import { requireServer } from '../utils';
import { startTransaction } from '../app/metrics';
import { Method, Handler, MethodType, Args, Context } from './types';

const methods: Record<string, Method<any>> = {};

export function createQuery<T extends any[]>(name: string, handler: Handler<T>) {
  requireServer();
  validateMethodName(name);
  return _createMethodInternal('query', name, handler);
}

export function createMutation<T extends any[]>(name: string, handler: Handler<T>) {
  requireServer();
  validateMethodName(name);
  return _createMethodInternal('mutation', name, handler);
}

function validateMethodName(name: string) {
  if (name.toLowerCase().startsWith('_system.')) {
    throw new Error(`Method name cannot start with a reserved prefix: '_system.' (${name})`);
  }
}

export function _createMethodInternal<T extends any>(type: MethodType, name: string, handler: Handler<T>) {
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
