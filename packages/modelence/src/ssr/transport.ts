import { _setCallMethodTransport, type MethodArgs } from '../client/method';
import { callInProcessMethod } from './callInProcess';
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

    return callInProcessMethod<T>(methodName, args, ssrCtx.callContext);
  });
}
