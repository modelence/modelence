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

function hasServerRenderedMarkup(): boolean {
  // The SSR pipeline emits `<script id="__MODELENCE_STATE__">` before the
  // root container. Its presence is the canonical signal that the DOM
  // already contains server-rendered markup we must hydrate. We deliberately
  // do NOT depend on `isSessionInitialized()` here: if `renderApp` failed
  // to parse the state script (malformed JSON), the session resolver hasn't
  // run, but the server-rendered HTML is still in the DOM. Showing the
  // loading shell in that case would cause a hydration mismatch and a
  // flash-of-spinner over already-rendered content.
  return typeof document !== 'undefined' && document.getElementById(SSR_STATE_SCRIPT_ID) !== null;
}

export function AppProvider({ children, loadingElement }: AppProviderProps) {
  // Skip the loading shell on the server (would defeat SSR), when the
  // session has already been hydrated client-side, or when the SSR marker
  // is present (the server-rendered content must be hydrated as-is, even
  // if session hydration silently failed).
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
        // SSR hydrated the session, but if `hydrateSession` detected a
        // token-in-localStorage / no-cookie mismatch it deferred actual
        // authentication. Run it now from the client where the token can
        // travel in the request body and the server can set the cookie.
        if (_isReconciliationPending()) {
          await reconcileSession();
        }
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
