import React from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Mock } from 'vitest';

const mockSetErrorHandler = vi.fn();

vi.doMock('./errorHandler', () => ({
  setErrorHandler: mockSetErrorHandler,
  handleError: jest.fn(),
}));

const mockCreateRoot = vi.fn(() => ({
  render: vi.fn(),
}));

vi.doMock('react-dom/client', () => ({
  createRoot: mockCreateRoot,
  default: {
    createRoot: mockCreateRoot,
  },
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

  beforeEach(() => {
    vi.clearAllMocks();
    linkElement = null;
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
      getElementById: (id: string) => (id === 'root' ? rootElement : null),
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
});
