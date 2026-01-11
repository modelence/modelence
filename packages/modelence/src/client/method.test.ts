import { beforeEach, describe, expect, jest, test } from '@jest/globals';

const mockGetLocalStorageSession = jest.fn();
const mockHandleError = jest.fn();
const mockReviveResponseTypes = jest.fn();

jest.unstable_mockModule('./localStorage', () => ({
  getLocalStorageSession: mockGetLocalStorageSession,
}));

jest.unstable_mockModule('./errorHandler', () => ({
  handleError: mockHandleError,
}));

jest.unstable_mockModule('../methods/serialize', () => ({
  reviveResponseTypes: mockReviveResponseTypes,
}));

const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;
const originalFetch = global.fetch;
const originalWindow = globalThis.window;

const { callMethod, MethodError } = await import('./method');

describe('client/method', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
    const spyJSON = jest.spyOn(JSON, 'parse');
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
    } as unknown as Response);

    await expect(callMethod('test.method')).rejects.toThrow('Payment required');
    expect(mockHandleError).toHaveBeenCalledWith(expect.any(MethodError), 'test.method');

    // Verify the error has the correct status
    const thrownError = mockHandleError.mock.calls[0][0] as InstanceType<typeof MethodError>;
    expect(thrownError.status).toBe(402);
    expect(thrownError.name).toBe('MethodError');
  });

  test('callMethod throws when response lacks data', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      text: async () => '',
    } as unknown as Response);

    await expect(callMethod('test.method')).rejects.toThrow('Invalid response from server');
  });
});
