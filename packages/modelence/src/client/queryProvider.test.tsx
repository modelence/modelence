import type { ReactElement } from 'react';
import { renderToString } from 'react-dom/server';
import { QueryClient, useQueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mockConnect = vi.fn();
vi.doMock('./query', () => ({
  connectModelenceQueryClient: mockConnect,
}));

const { ModelenceQueryProvider, _resetBrowserQueryClient } = await import('./queryProvider');

/** Renders the tree and returns every client the probe read from context. */
function renderWithProbe(element: (probe: ReactElement) => ReactElement): QueryClient[] {
  const rendered: QueryClient[] = [];
  function Probe() {
    rendered.push(useQueryClient());
    return null;
  }
  renderToString(element(<Probe />));
  return rendered;
}

describe('client/queryProvider', () => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;

  beforeEach(() => {
    vi.clearAllMocks();
    _resetBrowserQueryClient();
  });

  afterEach(() => {
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
  });

  describe('in the browser', () => {
    beforeEach(() => {
      globalThis.document = { getElementById: () => null } as unknown as Document;
      globalThis.window = { document: globalThis.document } as unknown as Window &
        typeof globalThis;
    });

    // StrictMode runs the useState initializer twice in development, which is the
    // same as mounting the provider twice. react-dom/server doesn't double-invoke,
    // so mount twice to cover it: both mounts must provide and connect one client.
    test('provides and connects one client across mounts', () => {
      const first = renderWithProbe((probe) => (
        <ModelenceQueryProvider>{probe}</ModelenceQueryProvider>
      ));
      const second = renderWithProbe((probe) => (
        <ModelenceQueryProvider>{probe}</ModelenceQueryProvider>
      ));

      expect(second[0]).toBe(first[0]);
      expect(mockConnect).toHaveBeenCalled();
      for (const [connected] of mockConnect.mock.calls) {
        expect(connected).toBe(first[0]);
      }
    });

    test('provides and connects the client passed in', () => {
      const client = new QueryClient();

      const rendered = renderWithProbe((probe) => (
        <ModelenceQueryProvider client={client}>{probe}</ModelenceQueryProvider>
      ));

      expect(rendered[0]).toBe(client);
      expect(mockConnect).toHaveBeenCalledWith(client);
    });
  });

  describe('on the server', () => {
    beforeEach(() => {
      // @ts-expect-error — simulate a server environment
      delete globalThis.window;
      // @ts-expect-error — simulate a server environment
      delete globalThis.document;
    });

    test('creates a new client per render and does not connect it', () => {
      const first = renderWithProbe((probe) => (
        <ModelenceQueryProvider>{probe}</ModelenceQueryProvider>
      ));
      const second = renderWithProbe((probe) => (
        <ModelenceQueryProvider>{probe}</ModelenceQueryProvider>
      ));

      expect(second[0]).not.toBe(first[0]);
      expect(mockConnect).not.toHaveBeenCalled();
    });
  });
});
