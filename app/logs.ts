import { getLogger } from './metrics';

export function logInfo(message: string, args: object) {
  const isTelemetryEnabled = process.env.MODELENCE_TELEMETRY_ENABLED === 'true';

  if (isTelemetryEnabled) {
    getLogger().info(message, args);
  }
}

export function logError(message: string, args: object) {
  const isTelemetryEnabled = process.env.MODELENCE_TELEMETRY_ENABLED === 'true';

  if (isTelemetryEnabled) {
    getLogger().error(message, args);
  }
}
