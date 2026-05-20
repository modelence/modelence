import React from 'react';
import ReactDOM from 'react-dom/client';
import { AppProvider } from '../client';
import { setErrorHandler, ErrorHandler } from './errorHandler';
import { hydrateSession, startSessionHeartbeat, type SessionInitPayload } from './session';
import { ModelenceQueryProvider } from './queryProvider';

const SSR_STATE_SCRIPT_ID = '__MODELENCE_STATE__';

type SsrState = {
  session?: SessionInitPayload;
};

function hasSsrMarker(): boolean {
  if (typeof document === 'undefined') {
    return false;
  }
  return document.getElementById(SSR_STATE_SCRIPT_ID) !== null;
}

function readSsrState(): SsrState | null {
  if (typeof document === 'undefined') {
    return null;
  }

  const node = document.getElementById(SSR_STATE_SCRIPT_ID);
  if (!node) {
    return null;
  }

  try {
    return JSON.parse(node.textContent ?? '') as SsrState;
  } catch (e) {
    // Caller must still hydrate (marker presence drives that, not parsed payload).
    console.error('Modelence: failed to parse SSR state', e);
    return null;
  }
}

export type SsrRouter = (props: {
  children: React.ReactNode;
  location?: string;
}) => React.ReactElement;

export interface RenderAppOptions {
  loadingElement: React.ReactNode;
  routesElement: React.ReactNode;
  favicon?: string;
  errorHandler?: ErrorHandler;
  router?: SsrRouter;
}

// Shared via globalThis: ssrLoadModule loads the user's entry in a separate
// module graph from the framework runtime.
const SNAPSHOT_KEY = '__modelence_ssr_snapshot__';

type GlobalWithSnapshot = typeof globalThis & {
  [SNAPSHOT_KEY]?: RenderAppOptions | null;
};

function setSnapshot(snapshot: RenderAppOptions | null) {
  (globalThis as GlobalWithSnapshot)[SNAPSHOT_KEY] = snapshot;
}

/** @internal Used by the SSR runtime after evaluating the user's entry. */
export function _getSsrSnapshot(): RenderAppOptions | null {
  return (globalThis as GlobalWithSnapshot)[SNAPSHOT_KEY] ?? null;
}

export function renderApp(options: RenderAppOptions) {
  if (typeof window === 'undefined') {
    setSnapshot(options);
    return;
  }

  const { loadingElement, routesElement, favicon, errorHandler, router } = options;

  if (errorHandler) {
    setErrorHandler(errorHandler);
  }

  // Empty 'unload' handler prevents bfcache in most browsers.
  window.addEventListener('unload', () => {});

  // Hydrate session BEFORE building the tree so `isSessionInitialized()` is
  // true on the first render and matches the server output. Hydration mode
  // tracks marker presence (not parse success): a parse failure still leaves
  // server-rendered DOM that must be hydrated, not replaced.
  const isHydrating = hasSsrMarker();
  const ssrState = readSsrState();
  if (ssrState?.session) {
    hydrateSession(ssrState.session);
    startSessionHeartbeat();
  }

  const container = document.getElementById('root')!;
  const routedTree = router ? router({ children: routesElement }) : routesElement;
  const tree = (
    <React.StrictMode>
      <AppProvider loadingElement={loadingElement}>
        <ModelenceQueryProvider>{routedTree}</ModelenceQueryProvider>
      </AppProvider>
    </React.StrictMode>
  );

  if (isHydrating) {
    ReactDOM.hydrateRoot(container, tree);
  } else {
    ReactDOM.createRoot(container).render(tree);
  }

  if (favicon) {
    const link = document.querySelector("link[rel~='icon']") as HTMLLinkElement;
    if (!link) {
      const newLink = document.createElement('link');
      newLink.rel = 'icon';
      newLink.href = favicon;
      document.head.appendChild(newLink);
    } else {
      link.href = favicon;
    }
  }
}
