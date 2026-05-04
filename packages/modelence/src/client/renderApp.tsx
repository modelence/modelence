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
    console.error('Modelence: failed to parse SSR state', e);
    return null;
  }
}

export type SsrRouter = (props: {
  children: React.ReactNode;
  location: string | undefined;
}) => React.ReactElement;

export interface RenderAppOptions {
  loadingElement: React.ReactNode;
  routesElement: React.ReactNode;
  favicon?: string;
  errorHandler?: ErrorHandler;
  router?: SsrRouter;
}

// Shared on globalThis because Vite's ssrLoadModule loads the user's entry
// in a separate module graph from the framework runtime.
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

  window.addEventListener('unload', () => {
    // Empty 'unload' handler prevents bfcache in most browsers.
  });

  const ssrState = readSsrState();
  const isHydrating = ssrState !== null;
  if (ssrState?.session) {
    hydrateSession(ssrState.session);
    startSessionHeartbeat();
  }

  const container = document.getElementById('root')!;
  const routedTree = router
    ? router({ children: routesElement, location: undefined })
    : routesElement;
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
