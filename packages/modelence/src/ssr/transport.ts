import {
  setCallMethodTransport,
  defaultCallMethodTransport,
  type MethodArgs,
} from '../client/method';
import { callInProcessMethod } from './callInProcess';
import { getSsrContext } from './context';

/**
 * Routes `callMethod` through `runMethod` in-process during an active SSR
 * render. Outside a render (e.g. server-side `callMethod` from jobs or other
 * non-render code) there is no request context, so it falls back to the
 * default HTTP transport — installing SSR must not break those call sites.
 */
export function installSsrCallMethodTransport(): () => void {
  return setCallMethodTransport(async <T>(methodName: string, args: MethodArgs) => {
    const ssrCtx = getSsrContext();
    if (!ssrCtx) {
      return defaultCallMethodTransport<T>(methodName, args);
    }

    return callInProcessMethod<T>(methodName, args, ssrCtx.callContext);
  });
}
