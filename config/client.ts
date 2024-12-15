import { ConfigKey, AppConfig, Configs } from './types';

let config: Record<ConfigKey, AppConfig> = {};

export function getConfig(key: ConfigKey) {
  if (!(key in config)) {
    throw new Error(`Unknown config: ${key}`);
  }

  return config[key]?.value;
}

export function _setConfig(configs: Configs) {
  config = configs;
}
