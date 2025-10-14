/*
  The "use client" directive is specifically for the Next.js layout component, which is rendered on the server by default.
  Because of this, we are explicitly marking it as a client component, so we can render this component on the client
  and properly initialize config on the client side.
  
  While this is specific to Next.js, it is simply ignored outside of Next.js and should not cause errors.
*/
'use client';

import React, { useState, useEffect, ReactNode } from 'react';
import { initSession } from './session';

interface AppProviderProps {
  children: ReactNode;
  loadingElement?: ReactNode;
}

let isInitialized = false;

export function AppProvider({ children, loadingElement }: AppProviderProps) {
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function initConfig() {
      if (isInitialized) {
        return;
      }

      isInitialized = true;

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
