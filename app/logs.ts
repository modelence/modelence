import { getLogger } from './metrics';

export function logInfo(message: string, args: object) {
  getLogger().info(message, args);
}

export function logError(message: string, args: object) {
  getLogger().error(message, args);
}
