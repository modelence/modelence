import { runMethod } from '../methods';
import { sanitizeResult, getResponseTypeMap, reviveResponseTypes } from '../methods/serialize';
import type { Context, Args } from '../methods/types';

/**
 * Invokes a Modelence method in-process and round-trips the result through the
 * same sanitize → typeMap → revive pipeline used by the HTTP transport, so
 * SSR consumers receive identical types to client callers.
 */
export async function callInProcessMethod<T = unknown>(
  methodName: string,
  args: Args,
  context: Context
): Promise<T> {
  const sanitized = sanitizeResult(await runMethod(methodName, args, context));
  const typeMap = getResponseTypeMap(sanitized);
  return reviveResponseTypes(sanitized, typeMap ?? undefined) as T;
}
