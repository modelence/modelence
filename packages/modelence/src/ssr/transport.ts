import { runMethod } from '../methods';
import { sanitizeResult, getResponseTypeMap, reviveResponseTypes } from '../methods/serialize';
import { _setCallMethodTransport, type MethodArgs } from '../client/method';
import { getSsrContext } from './context';

/** Routes `callMethod` through `runMethod` in-process during SSR. */
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
    // Match the HTTP wire format so type revivers behave identically client-side.
    const sanitized = sanitizeResult(raw);
    const typeMap = getResponseTypeMap(sanitized);
    return reviveResponseTypes(sanitized, typeMap ?? undefined) as T;
  });
}
