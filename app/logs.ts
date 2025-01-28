import { getLogger } from './metrics';

export function logInfo(message: string, args: object) {
  const isTelemetryEnabled = Boolean(process.env.MODELENCE_TELEMETRY_ENABLED);

  if (isTelemetryEnabled) {
    getLogger().info(message, args);
  }
}

export function logError(message: string, args: object) {
  const isTelemetryEnabled = Boolean(process.env.MODELENCE_TELEMETRY_ENABLED);

  if (isTelemetryEnabled) {
    getLogger().error(message, args);
  }
}
