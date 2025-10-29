import { getLogger, getApm } from '@/app/metrics';
import { isTelemetryEnabled } from '@/app/state';

export function logInfo(message: string, args: object) {
  if (isTelemetryEnabled()) {
    getLogger().info(message, args);
  }
}

export function logError(message: string, args: object) {
  if (isTelemetryEnabled()) {
    getLogger().error(message, args);
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
