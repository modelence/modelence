import { ConfigKey, AppConfig, Configs } from './types';

let config: Record<ConfigKey, AppConfig> = {};

export function getConfig(key: ConfigKey) {
  return config[key]?.value;
}

export function _setConfig(configs: Configs) {
  config = configs;
}
