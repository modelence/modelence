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
  // On the server, never render the loading state. The framework prefetches
  // session/config in `renderSsrTree` before invoking us, and serializes them
  // for the client to hydrate from. Rendering the loading element on the
  // server would defeat SSR (empty markup) and cause a hydration mismatch
  // since the client immediately resolves to children.
  const isServer = typeof window === 'undefined';

  // When the session was already initialized synchronously (SSR hydration
  // path), we skip the loading state to avoid a hydration mismatch and to
  // render the same tree the server produced.
  const [isLoading, setIsLoading] = useState(() => !isServer && !isSessionInitialized());

  useEffect(() => {
    async function initConfig() {
      if (isInitialized) {
        return;
      }

      isInitialized = true;

      if (isSessionInitialized()) {
        // Session was hydrated from SSR state — nothing to fetch.
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
