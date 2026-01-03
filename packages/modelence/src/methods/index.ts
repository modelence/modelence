import { requireServer } from '../utils';
import { startTransaction } from '@/telemetry';
import { requireAccess } from '../auth/role';
import { Method, MethodDefinition, MethodType, Args, Context } from './types';
import { runInLiveQueryContext, TrackedLiveQuery } from '../data/liveQueryContext';

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

  let response;
  try {
    requireAccess(context.roles, method.permissions);
    response = await handler(args, context);
  } catch (error) {
    // TODO: log error and associate it with the transaction
    transaction.end('error');
    throw error;
  }

  transaction.end();

  return response;
}

export type LiveMethodResult<T = unknown> = {
  result: T;
  trackedQueries: TrackedLiveQuery[];
};

export async function runLiveMethod(
  name: string,
  args: Args,
  context: Context
): Promise<LiveMethodResult> {
  requireServer();

  const method = methods[name];
  if (!method) {
    throw new Error(`Method with name '${name}' is not defined.`);
  }
  const { type, handler } = method;

  if (type !== 'query') {
    throw new Error(`Live methods are only supported for queries`);
  }

  const transaction = startTransaction('method', `method:${name}:live`, { type, args });

  try {
    requireAccess(context.roles, method.permissions);

    const { result, trackedQueries } = await runInLiveQueryContext(async () => {
      return await handler(args, context);
    });

    transaction.end();

    return { result, trackedQueries };
  } catch (error) {
    transaction.end('error');
    throw error;
  }
}
