import { ConfigKey, AppConfig } from './types';

let config: Record<ConfigKey, AppConfig> = {};

export function getConfig(key: ConfigKey) {
  return config[key]?.value;
}

export function _setConfig(configs: Record<ConfigKey, AppConfig>) {
  config = configs;
}
