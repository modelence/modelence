import { getLogger, getApm } from '@/app/metrics';
import { isTelemetryEnabled } from '@/app/state';

type LogLevel = 'error' | 'info' | 'debug' | '';

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
  if (isTelemetryEnabled()) {
    getLogger().debug(message, args);
  }
  if (getLogLevel() === 'debug') {
    console.debug(message, args);
  }
}

export function logInfo(message: string, args: object) {
  if (isTelemetryEnabled()) {
    getLogger().info(message, args);
  }
  if (['debug', 'info'].includes(getLogLevel())) {
    console.info(message, args);
  }
}

export function logError(message: string, args: object) {
  if (isTelemetryEnabled()) {
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
