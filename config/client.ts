import { ConfigKey, AppConfig } from './types';
import { callLoader } from '../client/loader';

let config: Record<ConfigKey, AppConfig> = {};

export function getConfig(key: ConfigKey) {
  return config[key]?.value;
}

export async function loadConfig() {
  config = await callLoader('_system.configs');
  console.log('client config', config);
}
