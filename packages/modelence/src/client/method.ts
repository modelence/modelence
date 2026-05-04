/*
  The "use client" directive is specifically for the Next.js layout component, which is rendered on the server by default.
  Because of this, we are explicitly marking it as a client component, so we can render this component on the client
  and properly initialize config on the client side.
  
  While this is specific to Next.js, it is simply ignored outside of Next.js and should not cause errors.
*/
'use client';

import { getAuthToken, getClientInfo } from '@/auth/client';
import { handleError } from '@/client/errorHandler';
import { reviveResponseTypes } from '@/methods/serialize';

export class MethodError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'MethodError';
    this.status = status;
  }
}

export type MethodArgs = Record<string, unknown>;

export type CallMethodOptions = {
  errorHandler?: (error: Error, methodName: string) => void;
};

/**
 * A transport for `callMethod`. The default uses `fetch` to hit the method
 * endpoint over HTTP. During SSR the framework swaps this for an in-process
 * transport that calls `runMethod` directly with the per-request context —
 * see `src/ssr/setup.ts`.
 */
export type CallMethodTransport = <T = unknown>(methodName: string, args: MethodArgs) => Promise<T>;

let transport: CallMethodTransport = async <T>(methodName: string, args: MethodArgs) =>
  call<T>(`/api/_internal/method/${methodName}`, args);

/**
 * Replace the transport used by `callMethod`. Returns a disposer that restores
 * the previous transport. Used by the SSR runtime to route method calls
 * through `runMethod` instead of `fetch`.
 */
export function _setCallMethodTransport(next: CallMethodTransport): () => void {
  const previous = transport;
  transport = next;
  return () => {
    transport = previous;
  };
}

export async function callMethod<T = unknown>(
  methodName: string,
  args: MethodArgs = {},
  options: CallMethodOptions = {}
): Promise<T> {
  try {
    return await transport<T>(methodName, args);
  } catch (error) {
    const handler = options.errorHandler ?? handleError;
    handler(error as Error, methodName);
    throw error;
  }
}

async function call<T = unknown>(endpoint: string, args: MethodArgs): Promise<T> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      args,
      authToken: getAuthToken(),
      clientInfo: getClientInfo(),
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new MethodError(error, response.status);
  }

  const text = await response.text();
  const result = text ? JSON.parse(text) : undefined;
  if (!result) {
    throw new Error('Invalid response from server');
  }

  return reviveResponseTypes(result.data, result.typeMap);
}
