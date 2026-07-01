import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mockGetLogger = vi.fn();
const mockGetApm = vi.fn();
const mockIsTelemetryEnabled = vi.fn();
const mockIsLoggerReady = vi.fn();

vi.doMock('@/app/metrics', () => ({
  getLogger: mockGetLogger,
  getApm: mockGetApm,
  isLoggerReady: mockIsLoggerReady,
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

  test('logDebug uses logger when telemetry enabled and console when log level is debug', () => {
    process.env.MODELENCE_LOG_LEVEL = 'debug';
    mockIsTelemetryEnabled.mockReturnValue(true);
    const logger = { debug: vi.fn(), info: vi.fn(), error: vi.fn() };
    mockGetLogger.mockReturnValue(logger);
    mockIsLoggerReady.mockReturnValue(true);

    telemetry.logDebug('debug-msg', { foo: 'bar' });

    expect(logger.debug).toHaveBeenCalledWith('debug-msg', { foo: 'bar' });
    expect(consoleDebug).toHaveBeenCalledWith('debug-msg', { foo: 'bar' });
  });

  test('logDebug uses only console when telemetry disabled and log level is debug', () => {
    process.env.MODELENCE_LOG_LEVEL = 'debug';
    mockIsTelemetryEnabled.mockReturnValue(false);

    telemetry.logDebug('debug-msg', { foo: 'bar' });

    expect(consoleDebug).toHaveBeenCalledWith('debug-msg', { foo: 'bar' });
  });

  test('logDebug does not log to console when log level is not debug', () => {
    process.env.MODELENCE_LOG_LEVEL = 'info';
    mockIsTelemetryEnabled.mockReturnValue(true);
    const logger = { debug: vi.fn(), info: vi.fn(), error: vi.fn() };
    mockGetLogger.mockReturnValue(logger);
    mockIsLoggerReady.mockReturnValue(true);

    telemetry.logDebug('debug-msg', { foo: 'bar' });

    expect(logger.debug).toHaveBeenCalledWith('debug-msg', { foo: 'bar' });
    expect(consoleDebug).not.toHaveBeenCalled();
  });

  test('logInfo uses logger when telemetry enabled and console when log level allows', () => {
    process.env.MODELENCE_LOG_LEVEL = 'info';
    mockIsTelemetryEnabled.mockReturnValue(true);
    const logger = { debug: vi.fn(), info: vi.fn(), error: vi.fn() };
    mockGetLogger.mockReturnValue(logger);
    mockIsLoggerReady.mockReturnValue(true);

    telemetry.logInfo('info-msg', { foo: 'bar' });

    expect(logger.info).toHaveBeenCalledWith('info-msg', { foo: 'bar' });
    expect(consoleInfo).toHaveBeenCalledWith('info-msg', { foo: 'bar' });
  });

  test('logInfo logs to console when log level is debug', () => {
    process.env.MODELENCE_LOG_LEVEL = 'debug';
    mockIsTelemetryEnabled.mockReturnValue(true);
    const logger = { debug: vi.fn(), info: vi.fn(), error: vi.fn() };
    mockGetLogger.mockReturnValue(logger);
    mockIsLoggerReady.mockReturnValue(true);

    telemetry.logInfo('info-msg', { foo: 'bar' });

    expect(logger.info).toHaveBeenCalledWith('info-msg', { foo: 'bar' });
    expect(consoleInfo).toHaveBeenCalledWith('info-msg', { foo: 'bar' });
  });

  test('logInfo does not log to console when log level is error', () => {
    process.env.MODELENCE_LOG_LEVEL = 'error';
    mockIsTelemetryEnabled.mockReturnValue(true);
    const logger = { debug: vi.fn(), info: vi.fn(), error: vi.fn() };
    mockGetLogger.mockReturnValue(logger);
    mockIsLoggerReady.mockReturnValue(true);

    telemetry.logInfo('info-msg', { foo: 'bar' });

    expect(logger.info).toHaveBeenCalledWith('info-msg', { foo: 'bar' });
    expect(consoleInfo).not.toHaveBeenCalled();
  });

  test('logError uses logger when telemetry enabled and console when log level allows', () => {
    process.env.MODELENCE_LOG_LEVEL = 'error';
    mockIsTelemetryEnabled.mockReturnValue(true);
    const logger = { debug: vi.fn(), info: vi.fn(), error: vi.fn() };
    mockGetLogger.mockReturnValue(logger);
    mockIsLoggerReady.mockReturnValue(true);

    telemetry.logError('error-msg', { foo: 'bar' });

    expect(logger.error).toHaveBeenCalledWith('error-msg', { foo: 'bar' });
    expect(consoleError).toHaveBeenCalledWith('error-msg', { foo: 'bar' });
  });

  test('logError uses console when telemetry disabled and log level allows', () => {
    process.env.MODELENCE_LOG_LEVEL = 'error';
    mockIsTelemetryEnabled.mockReturnValue(false);

    telemetry.logError('error-msg', { foo: 'bar' });

    expect(consoleError).toHaveBeenCalledWith('error-msg', { foo: 'bar' });
  });

  test('logError logs to console for debug and info levels', () => {
    process.env.MODELENCE_LOG_LEVEL = 'info';
    mockIsTelemetryEnabled.mockReturnValue(true);
    const logger = { debug: vi.fn(), info: vi.fn(), error: vi.fn() };
    mockGetLogger.mockReturnValue(logger);
    mockIsLoggerReady.mockReturnValue(true);

    telemetry.logError('error-msg', { foo: 'bar' });

    expect(logger.error).toHaveBeenCalledWith('error-msg', { foo: 'bar' });
    expect(consoleError).toHaveBeenCalledWith('error-msg', { foo: 'bar' });
  });

  test('logError does not log to console when log level is not set', () => {
    mockIsTelemetryEnabled.mockReturnValue(true);
    const logger = { debug: vi.fn(), info: vi.fn(), error: vi.fn() };
    mockGetLogger.mockReturnValue(logger);
    mockIsLoggerReady.mockReturnValue(true);

    telemetry.logError('error-msg', { foo: 'bar' });

    expect(logger.error).toHaveBeenCalledWith('error-msg', { foo: 'bar' });
    expect(consoleError).not.toHaveBeenCalled();
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
});
