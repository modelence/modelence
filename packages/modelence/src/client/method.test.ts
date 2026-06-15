import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { MockedFunction } from 'vitest';

const mockGetLocalStorageSession = vi.fn();
const mockHandleError = vi.fn();
const mockReviveResponseTypes = vi.fn();

vi.doMock('@/client/localStorage', () => ({
  getLocalStorageSession: mockGetLocalStorageSession,
  setLocalStorageSession: vi.fn(),
}));

vi.doMock('./errorHandler', () => ({
  handleError: mockHandleError,
}));

vi.doMock('../methods/serialize', () => ({
  reviveResponseTypes: mockReviveResponseTypes,
}));

const fetchMock = vi.fn() as MockedFunction<typeof fetch>;
const originalFetch = global.fetch;
const originalWindow = globalThis.window;

const { callMethod, MethodError } = await import('./method');

describe('client/method', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = fetchMock as unknown as typeof fetch;
    mockGetLocalStorageSession.mockReturnValue({ authToken: 'token' });
    mockReviveResponseTypes.mockImplementation((data) => data);
    fetchMock.mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ data: { ok: true }, typeMap: {} }),
    } as unknown as Response);

    globalThis.window = {
      screen: {
        width: 1024,
        height: 768,
        orientation: { type: 'landscape-primary' } as ScreenOrientation,
      } as Screen,
      innerWidth: 800,
      innerHeight: 600,
      devicePixelRatio: 2,
    } as unknown as Window & typeof globalThis;
  });

  afterAll(() => {
    global.fetch = originalFetch;
    globalThis.window = originalWindow;
  });

  test('callMethod posts to internal endpoint with client info and returns data', async () => {
    const spyJSON = vi.spyOn(JSON, 'parse');
    const result = await callMethod<{ ok: boolean }>('test.method', { foo: 'bar' });

    expect(fetchMock).toHaveBeenCalledWith('/api/_internal/method/test.method', expect.any(Object));
    const requestInit = fetchMock.mock.calls[0][1] as RequestInit;
    expect(requestInit?.method).toBe('POST');
    const payload = JSON.parse(requestInit?.body as string);
    expect(payload.args).toEqual({ foo: 'bar' });
    expect(payload.authToken).toBe('token');
    expect(payload.clientInfo).toMatchObject({
      screenWidth: window.screen.width,
      windowWidth: window.innerWidth,
    });
    expect(mockReviveResponseTypes).toHaveBeenCalledWith({ ok: true }, {});
    expect(result).toEqual({ ok: true });
    spyJSON.mockRestore();
  });

  test('callMethod throws MethodError with status code and propagates errors with handleError notification', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 402,
      text: async () => 'Payment required',
      headers: {
        get: (name: string) => (name === 'X-Modelence-Error-Code' ? 'PAYMENT_REQUIRED' : null),
      },
    } as unknown as Response);

    await expect(callMethod('test.method')).rejects.toThrow('Payment required');
    expect(mockHandleError).toHaveBeenCalledWith(expect.any(MethodError), 'test.method');

    // Verify the error has the correct status and propagated code
    const thrownError = mockHandleError.mock.calls[0][0] as InstanceType<typeof MethodError>;
    expect(thrownError.status).toBe(402);
    expect(thrownError.name).toBe('MethodError');
    expect(thrownError.code).toBe('PAYMENT_REQUIRED');
  });

  test('callMethod leaves code undefined when error code header is absent', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'Server error',
      headers: { get: () => null },
    } as unknown as Response);

    const thrownError = await callMethod('test.method').catch((e: unknown) => e);

    expect(thrownError).toBeInstanceOf(MethodError);
    expect((thrownError as InstanceType<typeof MethodError>).code).toBeUndefined();
  });

  test('callMethod throws when response lacks data', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      text: async () => '',
    } as unknown as Response);

    await expect(callMethod('test.method')).rejects.toThrow('Invalid response from server');
  });
});
