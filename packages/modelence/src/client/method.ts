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

// Default: fetch HTTP. SSR swaps in an in-process transport via globalThis
// so Vite's ssrLoadModule (separate module graph) shares the same instance.
export type CallMethodTransport = <T = unknown>(methodName: string, args: MethodArgs) => Promise<T>;

const defaultTransport: CallMethodTransport = async <T>(methodName: string, args: MethodArgs) =>
  call<T>(`/api/_internal/method/${methodName}`, args);

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

/**
 * Calls a server-side method (query or mutation) defined on a Modelence module.
 *
 * Both `args` and `options` are optional. Use the type parameter `T` to type the return value.
 *
 * @example
 * ```typescript
 * import { callMethod } from 'modelence/client';
 *
 * // No arguments
 * const todos = await callMethod<Todo[]>('todo.getAll');
 *
 * // With arguments
 * const todo = await callMethod<Todo>('todo.getOne', { id: '123' });
 *
 * // With a custom error handler
 * const created = await callMethod<Todo>(
 *   'todo.create',
 *   { title: 'Buy groceries' },
 *   { errorHandler: (error, methodName) => console.error(methodName, error) }
 * );
 * ```
 *
 * @param methodName - Fully qualified method name, e.g. `'todo.getAll'`.
 * @param args - Arguments passed to the server-side method. Defaults to `{}`.
 * @param options - Call-site options such as a custom {@link CallMethodOptions.errorHandler}. Defaults to `{}`.
 * @returns A promise that resolves to the method's return value.
 */
export async function callMethod<T = unknown>(
  methodName: string,
  args?: MethodArgs,
  options?: CallMethodOptions
): Promise<T> {
  args = args ?? {};
  options = options ?? {};
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
