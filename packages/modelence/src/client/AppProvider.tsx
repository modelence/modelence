/*
  The "use client" directive is specifically for the Next.js layout component, which is rendered on the server by default.
  Because of this, we are explicitly marking it as a client component, so we can render this component on the client
  and properly initialize config on the client side.

  While this is specific to Next.js, it is simply ignored outside of Next.js and should not cause errors.
*/
'use client';

import React, { useState, useEffect, ReactNode } from 'react';
import { initSession, isSessionInitialized } from './session';

interface AppProviderProps {
  children: ReactNode;
  loadingElement?: ReactNode;
}

let isInitialized = false;

export function AppProvider({ children, loadingElement }: AppProviderProps) {
  // Skip loading on the server (would defeat SSR) and when session is already
  // hydrated client-side (would cause a hydration mismatch).
  const isServer = typeof window === 'undefined';
  const [isLoading, setIsLoading] = useState(() => !isServer && !isSessionInitialized());

  useEffect(() => {
    async function initConfig() {
      if (isInitialized) {
        return;
      }

      isInitialized = true;

      if (isSessionInitialized()) {
        return;
      }

      await initSession();
      setIsLoading(false);
    }

    initConfig();
  }, []);

  if (isLoading) {
    return loadingElement ?? <div>Loading...</div>;
  }

  return children;
}
