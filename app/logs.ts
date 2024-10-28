import { log } from './metrics';

export function logInfo(message: string, args: object) {
  log(message, args, 'info');
}
