import { getLogger } from './metrics';

export function logInfo(message: string, args: object) {
  const isTelemetryEnabled = Boolean(process.env.MODELENCE_SERVICE_ENDPOINT);

  if (isTelemetryEnabled) {
    getLogger().info(message, args);
  }
}

export function logError(message: string, args: object) {
  const isTelemetryEnabled = Boolean(process.env.MODELENCE_SERVICE_ENDPOINT);

  if (isTelemetryEnabled) {
    getLogger().error(message, args);
  }
}
