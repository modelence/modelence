/*
  The "use client" directive is specifically for the Next.js layout component, which is rendered on the server by default.
  Because of this, we are explicitly marking it as a client component, so we can render this component on the client
  and properly initialize config on the client side.

  While this is specific to Next.js, it is simply ignored outside of Next.js and should not cause errors.
*/
'use client';

import { useState, useEffect, ReactNode } from 'react';
import { callMethod } from './method';
import SetupScreen from './SetupScreen';
import {
  _isReconciliationPending,
  _isSetupRequired,
  initSession,
  isSessionInitialized,
  reconcileSession,
} from './session';

const SSR_STATE_SCRIPT_ID = '__MODELENCE_STATE__';
const SETUP_POLL_INTERVAL = 3000;

interface AppProviderProps {
  children: ReactNode;
  loadingElement?: ReactNode;
  /*
    Replaces the built-in setup screen shown when a development server has no
    backend yet (see SetupScreen). Pass `null` to disable the screen entirely
    and render the app regardless.
  */
  setupElement?: ReactNode;
}

let isInitialized = false;

// Presence of the state script signals server-rendered markup in the DOM,
// even if `hydrateSession` failed to parse it. Hiding under a loading shell
// here would cause a hydration mismatch and a flash-of-spinner.
function hasServerRenderedMarkup(): boolean {
  return typeof document !== 'undefined' && document.getElementById(SSR_STATE_SCRIPT_ID) !== null;
}

export function AppProvider({ children, loadingElement, setupElement }: AppProviderProps) {
  const isServer = typeof window === 'undefined';
  const [isLoading, setIsLoading] = useState(
    () => !isServer && !isSessionInitialized() && !hasServerRenderedMarkup()
  );
  const [needsSetup, setNeedsSetup] = useState(
    () => !isServer && isSessionInitialized() && _isSetupRequired()
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
        // The initial useState read already saw the hydrated value, but only
        // because hydrateSession() runs before the first render — re-read
        // here so the setup screen doesn't depend on that ordering.
        setNeedsSetup(_isSetupRequired());
        return;
      }

      await initSession();
      setNeedsSetup(_isSetupRequired());
      setIsLoading(false);
    }

    void initConfig();
  }, []);

  // While the setup screen is up, watch for the project getting connected
  // (setup writes .modelence.env and the user restarts the dev server) and
  // reload for a clean boot. Poll errors are expected mid-restart.
  // Rescheduled after each poll settles, so requests never pile up while the
  // dev server hangs mid-restart and background-tab throttling can't burst.
  useEffect(() => {
    if (!needsSetup) {
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      try {
        const { setupRequired } = await callMethod<{ setupRequired: boolean }>(
          '_system.setupStatus',
          {},
          { errorHandler: () => {} }
        );
        if (!setupRequired) {
          window.location.reload();
          return;
        }
      } catch {
        // Dev server restarting — keep polling.
      }
      if (!cancelled) {
        timer = setTimeout(poll, SETUP_POLL_INTERVAL);
      }
    }

    timer = setTimeout(poll, SETUP_POLL_INTERVAL);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [needsSetup]);

  if (isLoading) {
    return loadingElement ?? <div>Loading...</div>;
  }

  if (needsSetup && setupElement !== null) {
    return setupElement ?? <SetupScreen />;
  }

  return children;
}
