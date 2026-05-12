import { runMethod } from '../methods';
import { sanitizeResult, getResponseTypeMap, reviveResponseTypes } from '../methods/serialize';
import type { Context, Args } from '../methods/types';

/**
 * Invokes a Modelence method in-process and round-trips the result through the
 * same sanitize → JSON → typeMap → revive pipeline used by the HTTP transport,
 * so SSR consumers receive identical values to client callers.
 *
 * The JSON.stringify → JSON.parse step is load-bearing: it strips `undefined`
 * object properties and normalizes other non-JSON values, matching what the
 * HTTP transport does implicitly. Without it, SSR-rendered output can disagree
 * with the dehydrated query cache (which always passes through JSON), causing
 * hydration mismatches when components probe property existence.
 */
export async function callInProcessMethod<T = unknown>(
  methodName: string,
  args: Args,
  context: Context
): Promise<T> {
  const sanitized = sanitizeResult(await runMethod(methodName, args, context));
  const typeMap = getResponseTypeMap(sanitized);
  const jsonRoundTripped = JSON.parse(JSON.stringify(sanitized));
  return reviveResponseTypes(jsonRoundTripped, typeMap ?? undefined) as T;
}
