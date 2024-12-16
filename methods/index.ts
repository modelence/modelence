import { requireServer } from '../utils';
import { startTransaction } from '../app/metrics';
import { Method, MethodDefinition, MethodType, Args, Context } from './types';

const methods: Record<string, Method<any>> = {};

export function createQuery<T extends any[]>(name: string, methodDef: MethodDefinition<T>) {
  requireServer();
  validateMethodName(name);
  return _createMethodInternal('query', name, methodDef);
}

export function createMutation<T extends any[]>(name: string, methodDef: MethodDefinition<T>) {
  requireServer();
  validateMethodName(name);
  return _createMethodInternal('mutation', name, methodDef);
}

export function _createSystemQuery<T extends any[]>(name: string, methodDef: MethodDefinition<T>) {
  requireServer();
  validateSystemMethodName(name);
  return _createMethodInternal('query', name, methodDef);
}

export function _createSystemMutation<T extends any[]>(name: string, methodDef: MethodDefinition<T>) {
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

function _createMethodInternal<T extends any>(type: MethodType, name: string, methodDef: MethodDefinition<T>) {
  requireServer();

  if (methods[name]) {
    throw new Error(`Method with name '${name}' is already defined.`);
  }

  const handler = typeof methodDef === 'function' ? methodDef : methodDef.handler;
  const permissions = typeof methodDef === 'function' ? [] : methodDef.permissions ?? [];
  methods[name] = { type, name, handler, permissions };
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
