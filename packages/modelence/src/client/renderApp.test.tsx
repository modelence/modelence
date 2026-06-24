import React from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Mock } from 'vitest';

const mockSetErrorHandler = vi.fn();

vi.doMock('./errorHandler', () => ({
  setErrorHandler: mockSetErrorHandler,
  handleError: vi.fn(),
}));

const mockCreateRoot = vi.fn(() => ({
  render: vi.fn(),
}));
const mockHydrateRoot = vi.fn();

vi.doMock('react-dom/client', () => ({
  createRoot: mockCreateRoot,
  hydrateRoot: mockHydrateRoot,
  default: {
    createRoot: mockCreateRoot,
    hydrateRoot: mockHydrateRoot,
  },
}));

const mockHydrateSession = vi.fn();
const mockStartSessionHeartbeat = vi.fn();

vi.doMock('./session', () => ({
  hydrateSession: mockHydrateSession,
  startSessionHeartbeat: mockStartSessionHeartbeat,
}));

const mockQueryProvider = vi.fn(({ children }: { children: React.ReactNode }) => <>{children}</>);

vi.doMock('./queryProvider', () => ({
  ModelenceQueryProvider: mockQueryProvider,
}));

const mockHasConnectedQueryClient = vi.fn(() => false);

vi.doMock('./query', () => ({
  hasConnectedQueryClient: mockHasConnectedQueryClient,
}));

vi.doMock('../client', () => ({
  AppProvider: ({
    children,
    loadingElement,
  }: {
    children: React.ReactNode;
    loadingElement: React.ReactNode;
  }) => (
    <div data-testid="app-provider">
      <span data-testid="loading">{loadingElement}</span>
      {children}
    </div>
  ),
}));

const { renderApp } = await import('./renderApp');

describe('client/renderApp', () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  let addEventListenerMock: Mock;
  let linkElement: { rel: string; href: string } | null;
  let ssrStateNode: { textContent: string } | null;

  beforeEach(() => {
    vi.clearAllMocks();
    mockHasConnectedQueryClient.mockReturnValue(false);
    linkElement = null;
    ssrStateNode = null;
    const rootElement = {};
    addEventListenerMock = vi.fn();
    const head = {
      appendChild: (el: { rel: string; href: string }) => {
        linkElement = el;
      },
      querySelectorAll: () => (linkElement ? [linkElement] : []),
    };
    globalThis.document = {
      body: { innerHTML: '' },
      head,
      getElementById: (id: string) => {
        if (id === 'root') return rootElement;
        if (id === '__MODELENCE_STATE__') return ssrStateNode;
        return null;
      },
      querySelector: (selector: string) => {
        if (selector.includes("link[rel~='icon']") || selector.includes("link[rel='icon']")) {
          return linkElement;
        }
        return null;
      },
      createElement: () => ({ rel: '', href: '' }),
    } as unknown as Document;

    globalThis.window = {
      addEventListener: addEventListenerMock,
      document: globalThis.document,
      location: { pathname: '/dashboard', search: '?tab=overview', hash: '#section' },
    } as unknown as Window & typeof globalThis;
  });

  afterEach(() => {
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
  });

  test('initializes error handler, attaches unload listener, and renders AppProvider', () => {
    renderApp({
      loadingElement: <div>Loading</div>,
      routesElement: <div>Routes</div>,
      errorHandler: vi.fn(),
    });

    expect(mockSetErrorHandler).toHaveBeenCalled();
    expect((mockCreateRoot as Mock).mock.calls[0]?.[0]).toBe(document.getElementById('root'));
    const rootResult = (mockCreateRoot as Mock).mock.results[0];
    const renderFn = rootResult ? (rootResult.value as { render: Mock }).render : undefined;
    expect(renderFn).toBeDefined();
    expect(renderFn).toHaveBeenCalledTimes(1);
    expect(addEventListenerMock).toHaveBeenCalledWith('unload', expect.any(Function));
  });

  test('creates favicon link when none exists', () => {
    renderApp({
      loadingElement: null,
      routesElement: null,
      favicon: '/icon.png',
    });

    const link = document.querySelector("link[rel='icon']");
    expect(link).not.toBeNull();
    expect((link as HTMLLinkElement).href).toContain('/icon.png');
  });

  test('updates existing favicon link', () => {
    linkElement = { rel: 'icon', href: '/old.ico' } as HTMLLinkElement;

    renderApp({
      loadingElement: null,
      routesElement: null,
      favicon: '/new.ico',
    });

    const link = document.querySelector("link[rel='icon']") as HTMLLinkElement;
    expect(link.href).toContain('/new.ico');
    expect(document.head.querySelectorAll("link[rel='icon']").length).toBe(1);
  });

  test('calls createRoot when no SSR marker is present', () => {
    renderApp({
      loadingElement: null,
      routesElement: null,
    });

    expect(mockCreateRoot).toHaveBeenCalledTimes(1);
    expect(mockHydrateRoot).not.toHaveBeenCalled();
    expect(mockHydrateSession).not.toHaveBeenCalled();
  });

  test('calls hydrateRoot and hydrates session when SSR marker has valid JSON', () => {
    const session = { user: null, configs: {} };
    ssrStateNode = { textContent: JSON.stringify({ session }) };

    renderApp({
      loadingElement: null,
      routesElement: null,
    });

    expect(mockHydrateRoot).toHaveBeenCalledTimes(1);
    expect(mockCreateRoot).not.toHaveBeenCalled();
    expect(mockHydrateSession).toHaveBeenCalledWith(session);
    expect(mockStartSessionHeartbeat).toHaveBeenCalledTimes(1);
  });

  test('passes browser location (path + search, no hash) to the router', () => {
    const router = vi.fn(({ children }: { children: React.ReactNode }) => <>{children}</>);

    renderApp({
      loadingElement: null,
      routesElement: <div>Routes</div>,
      router,
    });

    // Must match the server's req.originalUrl (path + search; hash is never
    // sent to the server) so a location-driven router hydrates the same route.
    expect(router).toHaveBeenCalledWith(
      expect.objectContaining({ location: '/dashboard?tab=overview' })
    );
  });

  function getRenderedTree(): React.ReactElement {
    const rootResult = (mockCreateRoot as Mock).mock.results[0];
    const renderFn = (rootResult?.value as { render: Mock }).render;
    return renderFn.mock.calls[0]?.[0] as React.ReactElement;
  }

  function treeContainsType(node: unknown, type: unknown): boolean {
    if (!React.isValidElement(node)) {
      return false;
    }
    if (node.type === type) {
      return true;
    }
    const children = (node.props as { children?: React.ReactNode }).children;
    return React.Children.toArray(children).some((child) => treeContainsType(child, type));
  }

  test('wraps routes in ModelenceQueryProvider when no client is connected', () => {
    mockHasConnectedQueryClient.mockReturnValue(false);

    renderApp({
      loadingElement: null,
      routesElement: <div>Routes</div>,
    });

    expect(treeContainsType(getRenderedTree(), mockQueryProvider)).toBe(true);
  });

  test('does not inject ModelenceQueryProvider when the app already connected a client', () => {
    // Bring-your-own-provider apps connect their QueryClient before renderApp.
    // Injecting a second provider would shadow their client so live-query
    // updates land on the wrong one.
    mockHasConnectedQueryClient.mockReturnValue(true);

    renderApp({
      loadingElement: null,
      routesElement: <div>Routes</div>,
    });

    expect(treeContainsType(getRenderedTree(), mockQueryProvider)).toBe(false);
  });

  test('calls hydrateRoot when SSR marker exists but JSON is malformed', () => {
    // Regression test: the SSR marker's presence — not the parsed payload —
    // determines hydration mode. A malformed payload still means the DOM
    // contains server-rendered markup that must be hydrated, not replaced.
    ssrStateNode = { textContent: '{not valid json' };
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    renderApp({
      loadingElement: null,
      routesElement: null,
    });

    expect(mockHydrateRoot).toHaveBeenCalledTimes(1);
    expect(mockCreateRoot).not.toHaveBeenCalled();
    expect(mockHydrateSession).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });
});
