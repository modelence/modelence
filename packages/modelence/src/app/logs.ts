import { getLogger } from './metrics';
import { isTelemetryEnabled } from './state';

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
