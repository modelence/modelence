import { getLogger, getApm, isLoggerReady } from '@/app/metrics';
import { isTelemetryEnabled } from '@/app/state';

type LogLevel = 'error' | 'info' | 'debug' | '';

// Secret-bearing keys to scrub before request args/query/body reach the APM sink.
// Matched case-insensitively as a substring (`authToken` matches `token`).
const SENSITIVE_KEYS = ['token', 'password', 'secret', 'nonce', 'code'];

/**
 * Deep-copies `value`, replacing any {@link SENSITIVE_KEYS} match with
 * `'[redacted]'`. Non-object values pass through unchanged.
 */
export function redactSensitive(value: unknown): unknown {
  if (!value || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(redactSensitive);
  }
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    const isSensitive = SENSITIVE_KEYS.some((k) => key.toLowerCase().includes(k));
    result[key] = isSensitive ? '[redacted]' : redactSensitive(val);
  }
  return result;
}

/**
 * Gets the logging level for console logs based on the MODELENCE_LOG_LEVEL environment variable.
 *
 * @returns The log level ('error' | 'info' | 'debug' | '')
 *
 * Behavior:
 * - If MODELENCE_LOG_LEVEL is set, returns that value
 * - If telemetry is disabled and MODELENCE_LOG_LEVEL is not set, defaults to 'info'
 * - If telemetry is enabled and MODELENCE_LOG_LEVEL is not set, returns '' (no console logging)
 */
function getLogLevel(): LogLevel {
  let defaultLoglevel: LogLevel = '';
  if (!isTelemetryEnabled()) {
    defaultLoglevel = 'info';
  }

  return (process.env.MODELENCE_LOG_LEVEL as LogLevel) || defaultLoglevel;
}

export function logDebug(message: string, args: object) {
  if (isTelemetryEnabled() && isLoggerReady()) {
    getLogger().debug(message, args);
  }
  if (getLogLevel() === 'debug') {
    console.debug(message, args);
  }
}

export function logInfo(message: string, args: object) {
  if (isTelemetryEnabled() && isLoggerReady()) {
    getLogger().info(message, args);
  }
  if (['debug', 'info'].includes(getLogLevel())) {
    console.info(message, args);
  }
}

export function logError(message: string, args: object) {
  if (isTelemetryEnabled() && isLoggerReady()) {
    getLogger().error(message, args);
  }
  if (['debug', 'info', 'error'].includes(getLogLevel())) {
    console.error(message, args);
  }
}

interface WrappedTransaction {
  end(result?: string, context?: Record<string, unknown>): void;
  setContext(context: Record<string, unknown>): void;
}

export function startTransaction(
  type: 'method' | 'cron' | 'ai' | 'custom' | 'route',
  name: string,
  context?: Record<string, unknown>
): WrappedTransaction {
  if (!isTelemetryEnabled()) {
    return {
      end: () => {
        // do nothing
      },
      setContext: () => {
        // do nothing
      },
    };
  }

  const apm = getApm();
  const transaction = apm.startTransaction(name, type);
  if (context) {
    apm.setCustomContext(context);
  }

  return {
    end: (
      result?: string,
      { endTime, context }: { endTime?: number; context?: Record<string, unknown> } = {}
    ) => {
      if (context) {
        apm.setCustomContext(context);
      }
      transaction.end(result, endTime);
    },
    setContext: (context: Record<string, unknown>) => {
      apm.setCustomContext(context);
    },
  };
}

export function captureError(error: Error) {
  if (!isTelemetryEnabled()) {
    console.error(error);
    return;
  }

  getApm().captureError(error);
}
