import { getApm } from '@/app/metrics';
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
 * Logs go to stdout/stderr only, where the hosting infrastructure (e.g. CloudWatch
 * via the container log driver) picks them up.
 *
 * @returns The log level ('error' | 'info' | 'debug'), defaulting to 'info'
 */
function getLogLevel(): LogLevel {
  return (process.env.MODELENCE_LOG_LEVEL as LogLevel) || 'info';
}

export function logDebug(message: string, args: object) {
  if (getLogLevel() === 'debug') {
    console.debug(message, args);
  }
}

export function logInfo(message: string, args: object) {
  if (['debug', 'info'].includes(getLogLevel())) {
    console.info(message, args);
  }
}

export function logError(message: string, args: object) {
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

/**
 * Single sink for server-side error reporting (method + route handlers).
 *
 * Elastic APM on → the error goes to APM once. Off (or APM unavailable) →
 * the console is the only sink, so it goes to stderr where the container log
 * driver picks it up. Never throws, so it is safe to call from Express catch
 * blocks without breaking the response.
 */
export function reportError(error: unknown, message: string) {
  try {
    if (!isTelemetryEnabled()) {
      console.error(`${message}:`, error);
      return;
    }
    const apm = getApm();
    if (error instanceof Error) {
      apm.captureError(error, { custom: { context: message } });
      return;
    }
    apm.captureError(Object.assign(new Error(`${message}: ${String(error)}`), { cause: error }));
  } catch {
    console.error(`${message}:`, error);
  }
}
