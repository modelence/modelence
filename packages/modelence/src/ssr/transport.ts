import { runMethod } from '../methods';
import { sanitizeResult, getResponseTypeMap, reviveResponseTypes } from '../methods/serialize';
import { _setCallMethodTransport, type MethodArgs } from '../client/method';
import { getSsrContext } from './context';

/**
 * Install an in-process transport for `callMethod` that runs server methods
 * directly via `runMethod`, using the active SSR request context for auth.
 *
 * Returns a disposer to restore the previous transport. The framework calls
 * this once at SSR runtime startup; per-request context is supplied via
 * `runWithSsrContext` in `context.ts`.
 */
export function installSsrCallMethodTransport(): () => void {
  return _setCallMethodTransport(async <T>(methodName: string, args: MethodArgs) => {
    const ssrCtx = getSsrContext();
    if (!ssrCtx) {
      throw new Error(
        `callMethod('${methodName}') was invoked during SSR but no request context is active. ` +
          `Wrap the render in runWithSsrContext().`
      );
    }

    const raw = await runMethod(methodName, args, ssrCtx.callContext);
    // Match the wire-format the HTTP transport produces so that revivers
    // (Date, ObjectId-as-string, etc.) behave identically on first paint and
    // subsequent client-side calls.
    const sanitized = sanitizeResult(raw);
    const typeMap = getResponseTypeMap(sanitized);
    return reviveResponseTypes(sanitized, typeMap ?? undefined) as T;
  });
}
