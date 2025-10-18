import { AppConfig, ConfigKey, Configs } from './types';

let config: Record<ConfigKey, AppConfig> = {};

/**
 * @sidebarTitle getConfig (client)
 *
 * @param key
 * @returns
 */
export function getConfig(key: ConfigKey) {
  return config[key]?.value;
}

export function _setConfig(configs: Configs) {
  config = configs;
}
