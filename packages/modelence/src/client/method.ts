/**
 * @group React Hooks
 * Client-side React hooks for data fetching and mutations
 */

/*
  The "use client" directive is specifically for the Next.js layout component, which is rendered on the server by default.
  Because of this, we are explicitly marking it as a client component, so we can render this component on the client
  and properly initialize config on the client side.
  
  While this is specific to Next.js, it is simply ignored outside of Next.js and should not cause errors.
*/
"use client";

import { getLocalStorageSession } from './localStorage';
import { handleError } from './errorHandler';
import { reviveResponseTypes } from '../methods/serialize';

type Args = Record<string, unknown>;

export async function callMethod<T = unknown>(methodName: string, args: Args = {}): Promise<T> {
  try {
    return await call<T>(`/api/_internal/method/${methodName}`, args);
  } catch (error) {
    handleError(error as Error, methodName);
    throw error;
  }
}

async function call<T = unknown>(endpoint: string, args: Args): Promise<T> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      args,
      authToken: getLocalStorageSession()?.authToken,
      clientInfo: {
        screenWidth: window.screen.width,
        screenHeight: window.screen.height,
        windowWidth: window.innerWidth,
        windowHeight: window.innerHeight,
        pixelRatio: window.devicePixelRatio,
        orientation: window.screen.orientation?.type
      }
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(error);
  }

  const text = await response.text();
  const result = text ? JSON.parse(text) : undefined;
  if (!result) {
    throw new Error('Invalid response from server');
  }

  return reviveResponseTypes(result.data, result.typeMap);
}
