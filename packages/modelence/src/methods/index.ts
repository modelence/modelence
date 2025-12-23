import { requireServer } from '../utils';
import { startTransaction } from '@/telemetry';
import { requireAccess } from '../auth/role';
import { AuthError } from '@/error';
import { Method, MethodDefinition, MethodType, Args, Context, AuthenticatedContext, Handler, AuthenticatedHandler } from './types';

const methods: Record<string, Method<unknown>> = {};

export function createQuery<T extends unknown[]>(name: string, methodDef: MethodDefinition<T>) {
  requireServer();
  validateMethodName(name);
  return _createMethodInternal('query', name, methodDef);
}

export function createMutation<T extends unknown[]>(name: string, methodDef: MethodDefinition<T>) {
  requireServer();
  validateMethodName(name);
  return _createMethodInternal('mutation', name, methodDef);
}

export function _createSystemQuery<T extends unknown[]>(
  name: string,
  methodDef: MethodDefinition<T>
) {
  requireServer();
  validateSystemMethodName(name);
  return _createMethodInternal('query', name, methodDef);
}

export function _createSystemMutation<T extends unknown[]>(
  name: string,
  methodDef: MethodDefinition<T>
) {
  requireServer();
  validateSystemMethodName(name);
  return _createMethodInternal('mutation', name, methodDef);
}

function validateMethodName(name: string) {
  if (name.toLowerCase().startsWith('_system.')) {
    throw new Error(`Method name cannot start with a reserved prefix: '_system.' (${name})`);
  }
}

function validateSystemMethodName(name: string) {
  if (!name.toLowerCase().startsWith('_system.')) {
    throw new Error(`System method name must start with a prefix: '_system.' (${name})`);
  }
}

function _createMethodInternal<T = unknown>(
  type: MethodType,
  name: string,
  methodDef: MethodDefinition<T>
) {
  requireServer();

  if (methods[name]) {
    throw new Error(`Method with name '${name}' is already defined.`);
  }

  const handler = typeof methodDef === 'function' ? methodDef : methodDef.handler;
  const permissions = typeof methodDef === 'function' ? [] : (methodDef.permissions ?? []);
  const requireAuth = typeof methodDef === 'function' ? false : (methodDef.requireAuth ?? false);
  methods[name] = { type, name, handler, permissions, requireAuth };
}

export async function runMethod(name: string, args: Args, context: Context) {
  requireServer();

  const method = methods[name];
  if (!method) {
    throw new Error(`Method with name '${name}' is not defined.`);
  }
  const { type, handler } = method;

  const transaction = startTransaction('method', `method:${name}`, { type, args });

  let response;
  try {
    if (method.requireAuth && !context.user) {
      throw new AuthError('Not authenticated');
    }
    requireAccess(context.roles, method.permissions);
    if (method.requireAuth) {
      response = await (handler as AuthenticatedHandler)(args, context as AuthenticatedContext);
    } else {
      response = await (handler as Handler)(args, context);
    }
  } catch (error) {
    // TODO: log error and associate it with the transaction
    transaction.end('error');
    throw error;
  }

  transaction.end();

  return response;
}
