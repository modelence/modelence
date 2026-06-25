/*
  The "use client" directive is specifically for the Next.js layout component, which is rendered on the server by default.
  Because of this, we are explicitly marking it as a client component, so we can render this component on the client
  and properly initialize config on the client side.

  While this is specific to Next.js, it is simply ignored outside of Next.js and should not cause errors.
*/
'use client';

import React, { useState, useEffect, ReactNode } from 'react';
import {
  _isReconciliationPending,
  initSession,
  isSessionInitialized,
  reconcileSession,
} from './session';

const SSR_STATE_SCRIPT_ID = '__MODELENCE_STATE__';

interface AppProviderProps {
  children: ReactNode;
  loadingElement?: ReactNode;
}

let isInitialized = false;

// Presence of the state script signals server-rendered markup in the DOM,
// even if `hydrateSession` failed to parse it. Hiding under a loading shell
// here would cause a hydration mismatch and a flash-of-spinner.
function hasServerRenderedMarkup(): boolean {
  return typeof document !== 'undefined' && document.getElementById(SSR_STATE_SCRIPT_ID) !== null;
}

export function AppProvider({ children, loadingElement }: AppProviderProps) {
  const isServer = typeof window === 'undefined';
  const [isLoading, setIsLoading] = useState(
    () => !isServer && !isSessionInitialized() && !hasServerRenderedMarkup()
  );

  useEffect(() => {
    async function initConfig() {
      if (isInitialized) {
        return;
      }

      isInitialized = true;

      if (isSessionInitialized()) {
        // SSR couldn't authenticate via cookie; reconcile via body token now.
        if (_isReconciliationPending()) {
          await reconcileSession();
        }
        return;
      }

      await initSession();
      setIsLoading(false);
    }

    void initConfig();
  }, []);

  if (isLoading) {
    return loadingElement ?? <div>Loading...</div>;
  }

  return children;
}
