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

// Defaults to fetch-based HTTP; the SSR runtime swaps in an in-process transport.
export type CallMethodTransport = <T = unknown>(methodName: string, args: MethodArgs) => Promise<T>;

const defaultTransport: CallMethodTransport = async <T>(methodName: string, args: MethodArgs) =>
  call<T>(`/api/_internal/method/${methodName}`, args);

// Shared on globalThis so Vite's `ssrLoadModule` (which loads the user's tree
// in a separate module graph from the framework runtime) sees the same
// transport that the SSR runtime installed. Without this, `useQuery` calls
// during SSR fall through to the default fetch-based transport and never
// populate the dehydrated cache.
const TRANSPORT_KEY = '__modelence_call_method_transport__';

type GlobalWithTransport = typeof globalThis & {
  [TRANSPORT_KEY]?: CallMethodTransport;
};

function getTransport(): CallMethodTransport {
  return (globalThis as GlobalWithTransport)[TRANSPORT_KEY] ?? defaultTransport;
}

/** Returns a disposer that restores the previous transport. */
export function _setCallMethodTransport(next: CallMethodTransport): () => void {
  const previous = (globalThis as GlobalWithTransport)[TRANSPORT_KEY];
  (globalThis as GlobalWithTransport)[TRANSPORT_KEY] = next;
  return () => {
    (globalThis as GlobalWithTransport)[TRANSPORT_KEY] = previous;
  };
}

export async function callMethod<T = unknown>(
  methodName: string,
  args: MethodArgs = {},
  options: CallMethodOptions = {}
): Promise<T> {
  try {
    return await getTransport()<T>(methodName, args);
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
