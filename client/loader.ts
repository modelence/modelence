/*
  The "use client" directive is specifically for the Next.js layout component, which is rendered on the server by default.
  Because of this, we are explicitly marking it as a client component, so we can render this component on the client
  and properly initialize config on the client side.
  
  While this is specific to Next.js, it is simply ignored outside of Next.js and should not cause errors.
*/
"use client";

import { useState, useEffect } from 'react';

type LoaderResult<T> = {
  isLoading: boolean;
  error: Error | null;
  data: T | null;
};

export async function callLoader<T>(loaderName: string, args: Record<string, unknown> = {}): Promise<T> {
  const response = await fetch(`/api/_internal/loader/${loaderName}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ args }),
  });

  if (!response.ok) {
    throw new Error(`Error calling loader '${loaderName}'. status: ${response.status}`);
  }

  return await response.json();
}

export function useLoader<T>(loaderName: string, args: Record<string, unknown> = {}): LoaderResult<T> {
  const [result, setResult] = useState<LoaderResult<T>>({
    isLoading: true,
    error: null,
    data: null,
  });

  useEffect(() => {
    const fetchData = async () => {
      try {
        const data = await callLoader<T>(loaderName, args);
        setResult({ isLoading: false, error: null, data });
      } catch (error) {
        setResult({ isLoading: false, error: error as Error, data: null });
      }
    };

    fetchData();
  }, [loaderName, args]);

  return result;
}
