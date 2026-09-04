import { afterAll, afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mockGetApm = vi.fn();
const mockIsTelemetryEnabled = vi.fn();

vi.doMock('@/app/metrics', () => ({
  getApm: mockGetApm,
}));

vi.doMock('@/app/state', () => ({
  isTelemetryEnabled: mockIsTelemetryEnabled,
}));

const telemetry = await import('./index');

describe('telemetry/index', () => {
  const consoleDebug = vi.spyOn(console, 'debug').mockImplementation(() => {});
  const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => {});
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.MODELENCE_LOG_LEVEL;
  });

  describe('redactSensitive', () => {
    test('redacts sensitive keys (substring, case-insensitive) and preserves others', () => {
      const input = {
        token: 'raw',
        Password: 'pw',
        linkNonce: 'n',
        verificationCode: 'c',
        apiSecret: 's',
        email: 'a@b.com',
        nested: { authToken: 't', label: 'keep' },
      };

      expect(telemetry.redactSensitive(input)).toEqual({
        token: '[redacted]',
        Password: '[redacted]',
        linkNonce: '[redacted]',
        verificationCode: '[redacted]',
        apiSecret: '[redacted]',
        email: 'a@b.com',
        nested: { authToken: '[redacted]', label: 'keep' },
      });
    });

    test('redacts inside arrays and passes through primitives', () => {
      expect(telemetry.redactSensitive([{ token: 'x' }, { ok: 1 }])).toEqual([
        { token: '[redacted]' },
        { ok: 1 },
      ]);
      expect(telemetry.redactSensitive('plain')).toBe('plain');
      expect(telemetry.redactSensitive(null)).toBe(null);
      expect(telemetry.redactSensitive(42)).toBe(42);
    });
  });

  afterEach(() => {
    consoleDebug.mockClear();
    consoleInfo.mockClear();
    consoleError.mockClear();
  });

  afterAll(() => {
    consoleDebug.mockRestore();
    consoleInfo.mockRestore();
    consoleError.mockRestore();
  });

  test('logDebug logs to console when log level is debug', () => {
    process.env.MODELENCE_LOG_LEVEL = 'debug';

    telemetry.logDebug('debug-msg', { foo: 'bar' });

    expect(consoleDebug).toHaveBeenCalledWith('debug-msg', { foo: 'bar' });
  });

  test('logDebug does not log to console when log level is not debug', () => {
    process.env.MODELENCE_LOG_LEVEL = 'info';

    telemetry.logDebug('debug-msg', { foo: 'bar' });

    expect(consoleDebug).not.toHaveBeenCalled();
  });

  test('logDebug does not log to console by default', () => {
    telemetry.logDebug('debug-msg', { foo: 'bar' });

    expect(consoleDebug).not.toHaveBeenCalled();
  });

  test('logInfo logs to console for debug and info levels', () => {
    process.env.MODELENCE_LOG_LEVEL = 'info';
    telemetry.logInfo('info-msg', { foo: 'bar' });
    expect(consoleInfo).toHaveBeenCalledWith('info-msg', { foo: 'bar' });

    consoleInfo.mockClear();
    process.env.MODELENCE_LOG_LEVEL = 'debug';
    telemetry.logInfo('info-msg', { foo: 'bar' });
    expect(consoleInfo).toHaveBeenCalledWith('info-msg', { foo: 'bar' });
  });

  test('logInfo logs to console by default', () => {
    telemetry.logInfo('info-msg', { foo: 'bar' });

    expect(consoleInfo).toHaveBeenCalledWith('info-msg', { foo: 'bar' });
  });

  test('logInfo does not log to console when log level is error', () => {
    process.env.MODELENCE_LOG_LEVEL = 'error';

    telemetry.logInfo('info-msg', { foo: 'bar' });

    expect(consoleInfo).not.toHaveBeenCalled();
  });

  test('logError logs to console for debug, info and error levels', () => {
    for (const level of ['debug', 'info', 'error']) {
      consoleError.mockClear();
      process.env.MODELENCE_LOG_LEVEL = level;

      telemetry.logError('error-msg', { foo: 'bar' });

      expect(consoleError).toHaveBeenCalledWith('error-msg', { foo: 'bar' });
    }
  });

  test('logError logs to console by default', () => {
    telemetry.logError('error-msg', { foo: 'bar' });

    expect(consoleError).toHaveBeenCalledWith('error-msg', { foo: 'bar' });
  });

  test('startTransaction returns noop handlers when telemetry disabled', () => {
    mockIsTelemetryEnabled.mockReturnValue(false);

    const txn = telemetry.startTransaction('method', 'noop');
    expect(typeof txn.end).toBe('function');
    expect(typeof txn.setContext).toBe('function');

    txn.setContext({ key: 'value' });
    txn.end();

    expect(mockGetApm).not.toHaveBeenCalled();
  });

  test('startTransaction wires through to APM when telemetry enabled', () => {
    mockIsTelemetryEnabled.mockReturnValue(true);
    const end = vi.fn();
    const transaction = { end };
    const apm = {
      startTransaction: vi.fn<(name: string, type: string) => typeof transaction>(
        () => transaction
      ),
      setCustomContext: vi.fn<(context: Record<string, unknown>) => void>(),
    };
    mockGetApm.mockReturnValue(apm);

    const txn = telemetry.startTransaction('method', 'process', { initial: true });

    expect(apm.startTransaction).toHaveBeenCalledWith('process', 'method');
    expect(apm.setCustomContext).toHaveBeenCalledWith({ initial: true });

    txn.setContext({ phase: 'mid' });
    expect(apm.setCustomContext).toHaveBeenCalledWith({ phase: 'mid' });

    txn.end('success', { endTime: 123, context: { phase: 'end' } });
    expect(apm.setCustomContext).toHaveBeenCalledWith({ phase: 'end' });
    expect(end).toHaveBeenCalledWith('success', 123);
  });

  test('captureError logs to console when telemetry disabled', () => {
    mockIsTelemetryEnabled.mockReturnValue(false);
    const error = new Error('boom');

    telemetry.captureError(error);

    expect(consoleError).toHaveBeenCalledWith(error);
  });

  test('captureError delegates to APM when telemetry enabled', () => {
    mockIsTelemetryEnabled.mockReturnValue(true);
    const captureError = vi.fn();
    mockGetApm.mockReturnValue({ captureError });

    const error = new Error('boom');
    telemetry.captureError(error);

    expect(captureError).toHaveBeenCalledWith(error);
  });

  test('reportError logs to console with context when telemetry disabled', () => {
    mockIsTelemetryEnabled.mockReturnValue(false);
    const error = new Error('boom');

    telemetry.reportError(error, 'Error calling myMethod');

    expect(consoleError).toHaveBeenCalledWith('Error calling myMethod:', error);
    expect(mockGetApm).not.toHaveBeenCalled();
  });

  test('reportError sends Error to APM with context, silent console, when enabled', () => {
    mockIsTelemetryEnabled.mockReturnValue(true);
    const captureError = vi.fn();
    mockGetApm.mockReturnValue({ captureError });

    const error = new Error('boom');
    telemetry.reportError(error, 'Error calling myMethod');

    expect(captureError).toHaveBeenCalledWith(error, {
      custom: { context: 'Error calling myMethod' },
    });
    expect(consoleError).not.toHaveBeenCalled();
  });

  test('reportError wraps non-Error with searchable message and cause', () => {
    mockIsTelemetryEnabled.mockReturnValue(true);
    const captureError = vi.fn();
    mockGetApm.mockReturnValue({ captureError });

    telemetry.reportError('boom', 'Error calling myMethod');

    expect(captureError).toHaveBeenCalledTimes(1);
    const sent = captureError.mock.calls[0][0] as Error;
    expect(sent).toBeInstanceOf(Error);
    expect(sent.message).toBe('Error calling myMethod: boom');
    expect((sent as Error & { cause: unknown }).cause).toBe('boom');
    expect(consoleError).not.toHaveBeenCalled();
  });

  test('reportError falls back to console when APM throws', () => {
    mockIsTelemetryEnabled.mockReturnValue(true);
    const captureError = vi.fn(() => {
      throw new Error('apm down');
    });
    mockGetApm.mockReturnValue({ captureError });

    const error = new Error('boom');
    expect(() => telemetry.reportError(error, 'Error calling myMethod')).not.toThrow();
    expect(consoleError).toHaveBeenCalledWith('Error calling myMethod:', error);
  });
});
