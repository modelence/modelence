import { getLogger, getApm } from '@/app/metrics';
import { isTelemetryEnabled } from '@/app/state';
import { getConfig } from '@/config/server';

function getLogLevel() {
  return getConfig('_system.log.level') as 'debug' | 'info' | 'error';
}

export function logDebug(message: string, args: object) {
  if (getLogLevel() === 'debug') {
    if (isTelemetryEnabled()) {
      getLogger().debug(message, args);
    } else {
      console.debug(message, args);
    }
  }
}

export function logInfo(message: string, args: object) {
  if (['debug', 'info'].includes(getLogLevel())) {
    if (isTelemetryEnabled()) {
      getLogger().info(message, args);
    } else {
      console.info(message, args);
    }
  }
}

export function logError(message: string, args: object) {
  if (isTelemetryEnabled()) {
    getLogger().error(message, args);
  } else {
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
