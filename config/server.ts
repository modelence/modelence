import { ConfigKey, AppConfig, ConfigSchema } from './types';

let configSchema: ConfigSchema = {};
let config: Record<ConfigKey, AppConfig> = {};
let isInitialized = false;

export function getConfig(key: ConfigKey) {
  return config[key]?.value;
}

export function getPublicConfigs() {
  if (!isInitialized) {
    throw new Error('Config is not initialized: an attempt was made to access configs before they were loaded');
  }

  return Object.fromEntries(
    Object.entries(config).filter(([key]) => configSchema[key]?.isPublic)
  );
}

export function loadConfigs(configs: AppConfig[]) {
  configs.forEach(({ key, type, value }) => {
    const isSystemConfig = key.toLowerCase().startsWith('_system.');

    if (!isSystemConfig && !configSchema[key]) {
      // Ignore unknown configs
      return;
    }

    config[key] = {
      key,
      type,
      value
    };
  });

  isInitialized = true;
}

export function setSchema(schema: ConfigSchema) {
  // TODO: more validation on the schema structure
  Object.entries(schema).forEach(([key, value]) => {
    const { type, isPublic } = value;

    if (key.toLowerCase().startsWith('_system.')) {
      throw new Error(`Config key cannot start with a reserved prefix: '_system.' (${key})`);
    }

    if (type === 'secret' && isPublic) {
      throw new Error(`Config ${key} with type "secret" cannot be public`);
    }
  });

  configSchema = schema;
}
