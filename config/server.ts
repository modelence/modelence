import { ConfigKey, AppConfig, ConfigSchema } from './types';

let configSchema: ConfigSchema = {};
let config: Record<ConfigKey, AppConfig> = {};

export function getConfig(key: ConfigKey) {
  return config[key];
}

export function getPublicConfigs() {
  return Object.fromEntries(
    Object.entries(config).filter(([key]) => configSchema[key]?.isPublic)
  );
}

export function loadConfigs(configs: AppConfig[]) {
  configs.forEach(({ key, type, value }) => {
    if (!configSchema[key]) {
      // Ignore unknown configs
      return;
    }

    config[key] = {
      key,
      type,
      value
    };
  });
}

export function setSchema(schema: ConfigSchema) {
  configSchema = schema;
}
