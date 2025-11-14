import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';

const mockGetLogger = jest.fn();
const mockGetApm = jest.fn();
const mockIsTelemetryEnabled = jest.fn();
const mockGetConfig = jest.fn();

jest.unstable_mockModule('@/app/metrics', () => ({
  getLogger: mockGetLogger,
  getApm: mockGetApm,
}));

jest.unstable_mockModule('@/app/state', () => ({
  isTelemetryEnabled: mockIsTelemetryEnabled,
}));

jest.unstable_mockModule('@/config/server', () => ({
  getConfig: mockGetConfig,
}));

const telemetry = await import('./index');

describe('telemetry/index', () => {
  const consoleDebug = jest.spyOn(console, 'debug').mockImplementation(() => {});
  const consoleInfo = jest.spyOn(console, 'info').mockImplementation(() => {});
  const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetConfig.mockReturnValue('info');
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

  test('logDebug uses logger debug when telemetry enabled and level debug', () => {
    mockGetConfig.mockReturnValue('debug');
    mockIsTelemetryEnabled.mockReturnValue(true);
    const logger = { debug: jest.fn(), info: jest.fn(), error: jest.fn() };
    mockGetLogger.mockReturnValue(logger);

    telemetry.logDebug('debug-msg', { foo: 'bar' });

    expect(logger.debug).toHaveBeenCalledWith('debug-msg', { foo: 'bar' });
    expect(consoleDebug).not.toHaveBeenCalled();
  });

  test('logDebug falls back to console when telemetry disabled', () => {
    mockGetConfig.mockReturnValue('debug');
    mockIsTelemetryEnabled.mockReturnValue(false);

    telemetry.logDebug('debug-msg', { foo: 'bar' });

    expect(consoleDebug).toHaveBeenCalledWith('debug-msg', { foo: 'bar' });
  });

  test('logInfo uses logger info when telemetry enabled and level allows', () => {
    mockGetConfig.mockReturnValue('info');
    mockIsTelemetryEnabled.mockReturnValue(true);
    const logger = { debug: jest.fn(), info: jest.fn(), error: jest.fn() };
    mockGetLogger.mockReturnValue(logger);

    telemetry.logInfo('info-msg', { foo: 'bar' });

    expect(logger.info).toHaveBeenCalledWith('info-msg', { foo: 'bar' });
    expect(consoleInfo).not.toHaveBeenCalled();
  });

  test('logError uses console when telemetry disabled', () => {
    mockIsTelemetryEnabled.mockReturnValue(false);

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
    const end = jest.fn();
    const transaction = { end };
    const apm = {
      startTransaction: jest.fn<(name: string, type: string) => typeof transaction>(
        () => transaction
      ),
      setCustomContext: jest.fn<(context: Record<string, unknown>) => void>(),
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
    const captureError = jest.fn();
    mockGetApm.mockReturnValue({ captureError });

    const error = new Error('boom');
    telemetry.captureError(error);

    expect(captureError).toHaveBeenCalledWith(error);
  });
});
