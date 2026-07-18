import React from 'react';
import ReactDOM from 'react-dom/client';
import { AppProvider } from '../client';
import { setErrorHandler, ErrorHandler } from './errorHandler';
import {
  hydrateSession,
  startSessionHeartbeat,
  revalidateSession,
  type SessionInitPayload,
} from './session';
import { ModelenceQueryProvider } from './queryProvider';
import { hasConnectedQueryClient } from './query';

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

  // Revalidate session when restoring from bfcache
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) {
      void revalidateSession();
    }
  });

  // Hydrate session BEFORE building the tree so `isSessionInitialized()` is
  // true on the first render and matches the server output. Hydration mode
  // tracks marker presence (not parse success): a parse failure still leaves
  // server-rendered DOM that must be hydrated, not replaced.
  const isHydrating = hasSsrMarker();
  const ssrState = readSsrState();
  if (ssrState?.session) {
    hydrateSession(ssrState.session);
    // Fire-and-forget: the heartbeat loop runs in the background.
    void startSessionHeartbeat();
  }

  const container = document.getElementById('root')!;
  // Pass the same location the server used (req.originalUrl == path + search;
  // the hash is never sent to the server) so a location-driven router (e.g. a
  // static router) resolves the same route on hydration as it did during SSR,
  // avoiding hydration mismatches.
  const location = window.location.pathname + window.location.search;
  const routedTree = router ? router({ children: routesElement, location }) : routesElement;

  // If the app already connected its own QueryClient (the documented
  // bring-your-own-provider pattern connects before calling renderApp), don't
  // inject ours. A second provider would shadow the user's client: useQuery
  // would read the inner client while live-query updates write to the outer
  // one, so real-time queries would never update.
  const appTree = hasConnectedQueryClient() ? (
    routedTree
  ) : (
    <ModelenceQueryProvider>{routedTree}</ModelenceQueryProvider>
  );

  const tree = (
    <React.StrictMode>
      <AppProvider loadingElement={loadingElement}>{appTree}</AppProvider>
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
