import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { renderToString } from 'react-dom/server';

vi.doMock('./session', () => ({
  initSession: vi.fn(async () => undefined),
  isSessionInitialized: vi.fn(() => false),
}));

const sessionMod = await import('./session');
const { AppProvider } = await import('./AppProvider');

const isSessionInitializedMock = sessionMod.isSessionInitialized as unknown as ReturnType<
  typeof vi.fn
>;

describe('client/AppProvider', () => {
  describe('AppProvider', () => {
    test('should export AppProvider component', () => {
      expect(AppProvider).toBeDefined();
      expect(typeof AppProvider).toBe('function');
    });

    test('should be a React component', () => {
      expect(AppProvider.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('initial loading state on the client', () => {
    const originalDocument = globalThis.document;
    const originalWindow = globalThis.window;
    let ssrMarker: { id: string } | null;

    beforeEach(() => {
      vi.clearAllMocks();
      ssrMarker = null;
      isSessionInitializedMock.mockReturnValue(false);

      globalThis.document = {
        getElementById: (id: string) =>
          id === '__MODELENCE_STATE__' && ssrMarker ? ssrMarker : null,
      } as unknown as Document;
      globalThis.window = {
        document: globalThis.document,
      } as unknown as Window & typeof globalThis;
    });

    afterEach(() => {
      globalThis.document = originalDocument;
      globalThis.window = originalWindow;
    });

    test('renders loadingElement on the client when no SSR marker and session not initialized', () => {
      const html = renderToString(
        <AppProvider loadingElement={<div>LOADING</div>}>
          <span>APP</span>
        </AppProvider>
      );
      expect(html).toContain('LOADING');
      expect(html).not.toContain('APP');
    });

    test('renders children (skips loading) when the SSR marker is present, even if session not initialized', () => {
      // Regression: a malformed SSR state payload leaves the marker in place
      // but `hydrateSession` is skipped. Without this fix, AppProvider would
      // show the loading shell over server-rendered content and cause a
      // hydration mismatch.
      ssrMarker = { id: '__MODELENCE_STATE__' };

      const html = renderToString(
        <AppProvider loadingElement={<div>LOADING</div>}>
          <span>APP</span>
        </AppProvider>
      );
      expect(html).toContain('APP');
      expect(html).not.toContain('LOADING');
    });

    test('renders children when the session is already initialized client-side', () => {
      isSessionInitializedMock.mockReturnValue(true);

      const html = renderToString(
        <AppProvider loadingElement={<div>LOADING</div>}>
          <span>APP</span>
        </AppProvider>
      );
      expect(html).toContain('APP');
      expect(html).not.toContain('LOADING');
    });
  });
});
