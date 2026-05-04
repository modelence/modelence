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

/**
 * Router wrapper. Receives the route tree as `children`, and on the server
 * the inbound request URL as `location`. On the client `location` is
 * `undefined` and the user typically returns a `<BrowserRouter>`. Lets
 * Modelence stay router-agnostic — the user picks `react-router-dom`,
 * `@tanstack/router`, or anything else.
 */
export type SsrRouter = (props: {
  children: React.ReactNode;
  location: string | undefined;
}) => React.ReactElement;

export interface RenderAppOptions {
  loadingElement: React.ReactNode;
  routesElement: React.ReactNode;
  favicon?: string;
  errorHandler?: ErrorHandler;
  /**
   * Router wrapper used by both CSR and SSR. On the server the framework
   * passes the request URL as `location`; on the client `location` is
   * `undefined`. Required for SSR; optional for CSR-only apps that already
   * include their router inside `routesElement`.
   */
  router?: SsrRouter;
}

/**
 * Shared on `globalThis` so the snapshot survives Vite's `ssrLoadModule`
 * dual-instance situation: the user's entry file (loaded through Vite's
 * module runner) and the framework's `serverSSR` (loaded by Node) end up
 * with separate copies of this module, but they share `globalThis`.
 */
const SNAPSHOT_KEY = '__modelence_ssr_snapshot__';

type GlobalWithSnapshot = typeof globalThis & {
  [SNAPSHOT_KEY]?: RenderAppOptions | null;
};

function setSnapshot(snapshot: RenderAppOptions | null) {
  (globalThis as GlobalWithSnapshot)[SNAPSHOT_KEY] = snapshot;
}

/**
 * @internal Read the snapshot captured by the most recent server-side
 * `renderApp` call. Used by the SSR render runtime to access the user's
 * route tree, loading element, and router after evaluating their entry
 * via Vite's `ssrLoadModule`.
 */
export function _getSsrSnapshot(): RenderAppOptions | null {
  return (globalThis as GlobalWithSnapshot)[SNAPSHOT_KEY] ?? null;
}

/**
 * Bootstrap a Modelence app.
 *
 * Always wraps the user's tree in `<ModelenceQueryProvider>`, which mounts
 * TanStack Query's `QueryClientProvider`, auto-connects Modelence's
 * live-query subscription manager, and hydrates the server-prefilled query
 * cache when SSR markup is present.
 *
 * SSR vs CSR is auto-detected from the page: if the server-side renderer
 * inlined a `__MODELENCE_STATE__` script (controlled by `startApp({ ssr })`
 * on the backend), the framework hydrates the existing DOM via
 * `hydrateRoot()` and skips the loading flash; otherwise it does a fresh
 * `createRoot().render()`.
 *
 * On the **server** (no `window`), captures the options so the SSR runtime
 * can render the same tree. Safe to call from a module that's evaluated
 * during SSR — does not touch `window`/`document`.
 */
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
    // The presence of any 'unload' event handler, even empty,
    // prevents bfcache in most browsers
  });

  // Detect SSR markup by looking for the inlined session script. When
  // present, we hydrate the existing DOM and skip the loading flash; when
  // absent, we do a fresh client render.
  const ssrState = readSsrState();
  const isHydrating = ssrState !== null;
  if (ssrState?.session) {
    hydrateSession(ssrState.session);
    // Heartbeat must still run on the client even when session was hydrated
    // from SSR — it keeps the session alive on the server.
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
