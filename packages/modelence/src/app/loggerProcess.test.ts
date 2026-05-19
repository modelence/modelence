import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mockLogInfo = vi.fn();
const mockLogError = vi.fn();

type TelemetryMetadata = {
  timestamp: Date | null;
  source: string;
  sequenceId?: number;
};

vi.doMock('@/telemetry', () => ({
  logInfo: mockLogInfo,
  logError: mockLogError,
}));

const { startLoggerProcess } = await import('./loggerProcess');

describe('app/loggerProcess', () => {
  const originalStdoutWrite = process.stdout.write;
  const originalStderrWrite = process.stderr.write;

  beforeEach(() => {
    vi.useFakeTimers();
    mockLogInfo.mockReset();
    mockLogError.mockReset();
  });

  afterEach(() => {
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  test('flushes stdout and stderr logs through telemetry callbacks', () => {
    startLoggerProcess({
      elasticCloudId: 'cloud',
      elasticApiKey: 'key',
    });

    process.stdout.write('first line\nsecond line\n');
    process.stderr.write('error line\n');

    vi.advanceTimersByTime(1000);

    expect(mockLogInfo).toHaveBeenCalledTimes(2);
    const stdoutMetaFirst = mockLogInfo.mock.calls[0]?.[1] as TelemetryMetadata | undefined;
    const stdoutMetaSecond = mockLogInfo.mock.calls[1]?.[1] as TelemetryMetadata | undefined;
    const stderrMeta = mockLogError.mock.calls[0]?.[1] as TelemetryMetadata | undefined;

    expect(mockLogInfo).toHaveBeenNthCalledWith(
      1,
      'first line',
      expect.objectContaining({
        source: 'console',
        timestamp: expect.any(Date),
      })
    );

    expect(mockLogInfo).toHaveBeenNthCalledWith(
      2,
      'second line',
      expect.objectContaining({
        source: 'console',
        timestamp: expect.any(Date),
      })
    );

    expect(mockLogError).toHaveBeenCalledWith(
      'error line',
      expect.objectContaining({
        source: 'console',
        timestamp: expect.any(Date),
      })
    );

    expect(stdoutMetaSecond?.sequenceId).toBeGreaterThan(stdoutMetaFirst?.sequenceId ?? 0);
    expect(stderrMeta?.sequenceId).toBeGreaterThan(stdoutMetaSecond?.sequenceId ?? 0);
  });

  test('buffers partial stdout lines until newline is received', () => {
    startLoggerProcess({
      elasticCloudId: 'cloud',
      elasticApiKey: 'key',
    });

    process.stdout.write('partial');
    vi.advanceTimersByTime(1000);

    expect(mockLogInfo).not.toHaveBeenCalled();

    process.stdout.write(' message\nnext line\n');
    vi.advanceTimersByTime(1000);

    expect(mockLogInfo).toHaveBeenCalledTimes(2);

    expect(mockLogInfo).toHaveBeenNthCalledWith(
      1,
      'partial message',
      expect.objectContaining({
        source: 'console',
        timestamp: expect.any(Date),
      })
    );

    expect(mockLogInfo).toHaveBeenNthCalledWith(
      2,
      'next line',
      expect.objectContaining({
        source: 'console',
        timestamp: expect.any(Date),
      })
    );

    const firstMeta = mockLogInfo.mock.calls[0]?.[1] as TelemetryMetadata | undefined;
    const secondMeta = mockLogInfo.mock.calls[1]?.[1] as TelemetryMetadata | undefined;
    expect(secondMeta?.sequenceId).toBeGreaterThan(firstMeta?.sequenceId ?? 0);
  });
});
