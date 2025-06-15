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

export function startTransaction(type: 'method' | 'cron' | 'ai' | 'custom', name: string, context?: Record<string, any>) {
  if (!isTelemetryEnabled()) {
    return {
      end: () => {
        // do nothing
      }
    };
  }

  const apm = getApm();
  const transaction = apm.startTransaction(name, type);
  if (context) {
    apm.setCustomContext(context);
  }
  return transaction;
}

export function captureError(error: Error) {
  if (!isTelemetryEnabled()) {
    console.error(error);
    return;
  }

  getApm().captureError(error);
}
