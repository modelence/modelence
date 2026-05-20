import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

vi.doMock('./method', () => ({
  callMethod: vi.fn(),
}));

const mockStartWebsockets = vi.fn();
const mockSubscribeLiveQuery = vi.fn();
vi.doMock('../websocket/client', () => ({
  startWebsockets: mockStartWebsockets,
  subscribeLiveQuery: mockSubscribeLiveQuery,
}));

const { modelenceLiveQuery, disconnectModelenceQueryClient } = await import('./query');

describe('modelenceLiveQuery', () => {
  const originalWindow = globalThis.window;

  beforeEach(() => {
    vi.clearAllMocks();
    disconnectModelenceQueryClient();
  });

  afterEach(() => {
    globalThis.window = originalWindow;
  });

  test('queryFn returns a never-resolving promise on the server (no window)', async () => {
    // Simulate server context.
    // @ts-expect-error — deleting for test
    delete globalThis.window;

    const options = modelenceLiveQuery('todos.subscribe');
    const promise = options.queryFn();

    // Race the queryFn against a short timer. If it neither resolves nor
    // rejects within the timer, it's correctly pending. The point is that
    // on the server it must NOT reject (no console.error spam, no error
    // captured into the dehydrated state).
    const settled = await Promise.race([
      promise.then(() => 'resolved').catch(() => 'rejected'),
      new Promise<string>((r) => setTimeout(() => r('pending'), 50)),
    ]);

    expect(settled).toBe('pending');
    expect(mockStartWebsockets).not.toHaveBeenCalled();
    expect(mockSubscribeLiveQuery).not.toHaveBeenCalled();
  });

  test('queryFn rejects on the client when no QueryClient is connected', async () => {
    // Simulate browser context with no connected client.
    // @ts-expect-error — minimal stub
    globalThis.window = {};

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const options = modelenceLiveQuery('todos.subscribe');
    await expect(options.queryFn()).rejects.toThrow(/connect a QueryClient/);
    expect(consoleErrorSpy).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });
});
