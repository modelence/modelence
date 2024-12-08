import { getLogger } from './metrics';

const isTelemetryEnabled = Boolean(process.env.MODELENCE_SERVICE_ENDPOINT);

export function logInfo(message: string, args: object) {
  if (isTelemetryEnabled) {
    getLogger().info(message, args);
  }
}

export function logError(message: string, args: object) {
  if (isTelemetryEnabled) {
    getLogger().error(message, args);
  }
}
