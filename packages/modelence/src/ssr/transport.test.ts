import { describe, test, expect, vi, beforeEach } from 'vitest';
import type { Context } from '../methods/types';
import type { SsrRequestContext } from './context';

// Capture the transport installed by installSsrCallMethodTransport so we can
// invoke it directly and assert how it routes calls.
let installedTransport:
  | (<T>(methodName: string, args: Record<string, unknown>) => Promise<T>)
  | null = null;
const mockSetCallMethodTransport = vi.fn((next: typeof installedTransport) => {
  installedTransport = next;
  return () => {
    installedTransport = null;
  };
});
const mockDefaultTransport = vi.fn(async () => 'http-result');

vi.doMock('../client/method', () => ({
  setCallMethodTransport: mockSetCallMethodTransport,
  defaultCallMethodTransport: mockDefaultTransport,
}));

const mockCallInProcessMethod = vi.fn(async () => 'in-process-result');
vi.doMock('./callInProcess', () => ({
  callInProcessMethod: mockCallInProcessMethod,
}));

const mockGetSsrContext = vi.fn<() => SsrRequestContext | undefined>();
vi.doMock('./context', () => ({
  getSsrContext: mockGetSsrContext,
}));

const { installSsrCallMethodTransport } = await import('./transport');

describe('ssr/transport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installedTransport = null;
    installSsrCallMethodTransport();
  });

  test('routes through the in-process method when an SSR context is active', async () => {
    const callContext = { user: 'u1' } as unknown as Context;
    mockGetSsrContext.mockReturnValue({ callContext } as SsrRequestContext);

    const result = await installedTransport!('todo.getAll', { limit: 5 });

    expect(mockCallInProcessMethod).toHaveBeenCalledWith('todo.getAll', { limit: 5 }, callContext);
    expect(mockDefaultTransport).not.toHaveBeenCalled();
    expect(result).toBe('in-process-result');
  });

  test('falls back to the default HTTP transport when no SSR context is active', async () => {
    // Server-side callMethod outside a render (jobs, other non-render code)
    // must keep working after SSR installs its transport.
    mockGetSsrContext.mockReturnValue(undefined);

    const result = await installedTransport!('todo.getAll', { limit: 5 });

    expect(mockDefaultTransport).toHaveBeenCalledWith('todo.getAll', { limit: 5 });
    expect(mockCallInProcessMethod).not.toHaveBeenCalled();
    expect(result).toBe('http-result');
  });
});
