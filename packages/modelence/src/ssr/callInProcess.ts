import { runMethod } from '../methods';
import { sanitizeResult, getResponseTypeMap, reviveResponseTypes } from '../methods/serialize';
import type { Context, Args } from '../methods/types';

// Invoke a method in-process and round-trip through the same JSON pipeline
// as the HTTP transport so SSR output matches the dehydrated query cache.
// The JSON.stringify/parse step is load-bearing: strips `undefined` props.
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
