/*
  The "use client" directive is specifically for the Next.js layout component, which is rendered on the server by default.
  Because of this, we are explicitly marking it as a client component, so we can render this component on the client
  and properly initialize config on the client side.
  
  While this is specific to Next.js, it is simply ignored outside of Next.js and should not cause errors.
*/
"use client";

import { useState, useEffect, useMemo } from 'react';
import { getLocalStorageSession } from './localStorage';
import { handleError } from './errorHandler';

type Args = Record<string, unknown>;

type MethodResult<T> = {
  isLoading: boolean;
  error: Error | null;
  data: T | null;
};

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
  return text ? JSON.parse(text) : undefined;
}

export function useLoader<T>(methodName: string, args: Args = {}): MethodResult<T> {
  // Memoize the args object to maintain reference stability and prevent infinite re-renders
  const stableArgs = useMemo(() => args, [JSON.stringify(args)]);

  const [result, setResult] = useState<MethodResult<T>>({
    isLoading: true,
    error: null,
    data: null,
  });

  // TODO: switch to React Query (TanStack Query)
  useEffect(() => {
    const fetchData = async () => {
      try {
        const data = await callMethod<T>(methodName, stableArgs);
        setResult({ isLoading: false, error: null, data });
      } catch (error) {
        setResult({ isLoading: false, error: error as Error, data: null });
      }
    };

    fetchData();
  }, [methodName, stableArgs]);

  return result;
}
