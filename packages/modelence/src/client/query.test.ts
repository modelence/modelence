import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryObserver } from '@tanstack/react-query';

vi.doMock('./method', () => ({
  callMethod: vi.fn(),
}));

const mockStartWebsockets = vi.fn();
const mockSubscribeLiveQuery = vi.fn();
const mockReconnectWebsockets = vi.fn();
vi.doMock('../websocket/client', () => ({
  startWebsockets: mockStartWebsockets,
  subscribeLiveQuery: mockSubscribeLiveQuery,
  reconnectWebsockets: mockReconnectWebsockets,
}));

const {
  modelenceLiveQuery,
  disconnectModelenceQueryClient,
  connectModelenceQueryClient,
  revalidateModelenceQueries,
} = await import('./query');

describe('modelenceLiveQuery', () => {
  const originalWindow = globalThis.window;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSubscribeLiveQuery.mockReturnValue(vi.fn());
    disconnectModelenceQueryClient();
  });

  afterEach(() => {
    globalThis.window = originalWindow;
  });

  test('revalidateModelenceQueries invalidates queries on connected QueryClient', () => {
    const mockInvalidateQueries = vi.fn();
    const fakeQueryClient = {
      getQueryCache: () => ({ subscribe: vi.fn() }),
      invalidateQueries: mockInvalidateQueries,
    } as unknown as Parameters<typeof connectModelenceQueryClient>[0];

    connectModelenceQueryClient(fakeQueryClient);
    revalidateModelenceQueries();

    expect(mockInvalidateQueries).toHaveBeenCalledTimes(1);
    expect(mockReconnectWebsockets).not.toHaveBeenCalled();
  });

  test('revalidateModelenceQueries reconnects websockets if websockets were started', () => {
    // Simulate browser context
    // @ts-expect-error — minimal stub
    globalThis.window = {};

    const fakeQueryClient = {
      getQueryCache: () => ({ subscribe: vi.fn() }),
      invalidateQueries: vi.fn(),
    } as unknown as Parameters<typeof connectModelenceQueryClient>[0];
    connectModelenceQueryClient(fakeQueryClient);

    const options = modelenceLiveQuery('todos.subscribe');
    void options.queryFn();

    expect(mockStartWebsockets).toHaveBeenCalledTimes(1);

    revalidateModelenceQueries();
    expect(mockReconnectWebsockets).toHaveBeenCalledTimes(1);
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

  test('invalidating a live query that already has data settles with the latest value', async () => {
    // @ts-expect-error minimal window stub
    globalThis.window = {};

    let pushData: (data: unknown) => void = () => {};
    mockSubscribeLiveQuery.mockImplementation((_method, _args, onData) => {
      pushData = onData;
      return vi.fn();
    });

    const queryClient = new QueryClient();
    connectModelenceQueryClient(queryClient);

    const options = modelenceLiveQuery('todos.subscribe');
    const observer = new QueryObserver(queryClient, options);
    const unsubscribeObserver = observer.subscribe(() => {});

    await vi.waitFor(() => expect(mockSubscribeLiveQuery).toHaveBeenCalledTimes(1));
    pushData(['first']);
    await vi.waitFor(() => expect(observer.getCurrentResult().data).toEqual(['first']));
    pushData(['second']);

    const settled = await Promise.race([
      queryClient.invalidateQueries({ queryKey: options.queryKey }).then(() => 'settled'),
      new Promise<string>((r) => setTimeout(() => r('pending'), 50)),
    ]);

    expect(settled).toBe('settled');
    expect(observer.getCurrentResult().data).toEqual(['second']);
    expect(observer.getCurrentResult().fetchStatus).toBe('idle');
    expect(mockSubscribeLiveQuery).toHaveBeenCalledTimes(1);

    unsubscribeObserver();
    queryClient.clear();
  });

  describe('when the server revokes access', () => {
    type LiveCallbacks = {
      onData: (data: unknown) => void;
      onError: (error: string, details?: { isResubscribe: boolean }) => void;
    };

    function observeLiveQuery(args: Record<string, unknown> = {}) {
      // @ts-expect-error minimal window stub
      globalThis.window = {};
      const live: LiveCallbacks[] = [];
      const unsubscribeLive = vi.fn();
      mockSubscribeLiveQuery.mockImplementation((_method, _args, onData, onError) => {
        live.push({ onData, onError });
        return unsubscribeLive;
      });

      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      connectModelenceQueryClient(queryClient);
      const observer = new QueryObserver(queryClient, modelenceLiveQuery('todos.list', args));
      const stopObserving = observer.subscribe(() => {});
      return {
        live,
        observer,
        queryClient,
        unsubscribeLive,
        cleanup: () => {
          stopObserving();
          queryClient.clear();
        },
      };
    }

    async function pushFirstFrame({ live, observer }: ReturnType<typeof observeLiveQuery>) {
      await vi.waitFor(() => expect(live).toHaveLength(1));
      live[0].onData(['old']);
      await vi.waitFor(() => expect(observer.getCurrentResult().data).toEqual(['old']));
    }

    test('subscribes again and shows the new data', async () => {
      const query = observeLiveQuery();
      await pushFirstFrame(query);

      query.live[0].onError('Access revoked');

      await vi.waitFor(() => expect(query.live).toHaveLength(2));
      expect(query.unsubscribeLive).toHaveBeenCalledTimes(1);
      query.live[1].onData(['new']);
      await vi.waitFor(() => expect(query.observer.getCurrentResult().data).toEqual(['new']));
      expect(query.observer.getCurrentResult().status).toBe('success');
      query.cleanup();
    });

    test('reports an error, without looping, when the new subscription is rejected', async () => {
      const query = observeLiveQuery();
      await pushFirstFrame(query);

      query.live[0].onError('Access revoked');
      await vi.waitFor(() => expect(query.live).toHaveLength(2));
      query.live[1].onError('Access revoked');

      await vi.waitFor(() => expect(query.observer.getCurrentResult().status).toBe('error'));
      expect(query.observer.getCurrentResult().error).toEqual(new Error('Access revoked'));
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(query.live).toHaveLength(2);
      query.cleanup();
    });

    test('does not refetch other live queries of the same method', async () => {
      const query = observeLiveQuery();
      await pushFirstFrame(query);
      const otherOptions = modelenceLiveQuery('todos.list', { done: true });
      const other = new QueryObserver(query.queryClient, otherOptions);
      const stopOther = other.subscribe(() => {});
      await vi.waitFor(() => expect(query.live).toHaveLength(2));
      query.live[1].onData(['other']);
      await vi.waitFor(() => expect(other.getCurrentResult().data).toEqual(['other']));
      const otherUpdateCount = () =>
        query.queryClient.getQueryState(otherOptions.queryKey)?.dataUpdateCount;
      // The first frame updates the query twice: setQueryData, then the resolved queryFn.
      await vi.waitFor(() => expect(other.getCurrentResult().fetchStatus).toBe('idle'));
      const updatesBefore = otherUpdateCount();

      query.live[0].onError('Access revoked');

      await vi.waitFor(() => expect(query.live).toHaveLength(3));
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(otherUpdateCount()).toBe(updatesBefore);
      stopOther();
      query.cleanup();
    });

    test('reports an error when the subscription is refused after a reconnect', async () => {
      const query = observeLiveQuery();
      await pushFirstFrame(query);

      query.live[0].onError('Access denied', { isResubscribe: true });
      await vi.waitFor(() => expect(query.live).toHaveLength(2));
      query.live[1].onError('Access denied');

      await vi.waitFor(() => expect(query.observer.getCurrentResult().status).toBe('error'));
      expect(query.observer.getCurrentResult().error).toEqual(new Error('Access denied'));
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(query.live).toHaveLength(2);
      query.cleanup();
    });

    test('does not subscribe again after other errors', async () => {
      const query = observeLiveQuery();
      await pushFirstFrame(query);

      query.live[0].onError('fetch failed');

      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(query.live).toHaveLength(1);
      query.cleanup();
    });
  });
});
