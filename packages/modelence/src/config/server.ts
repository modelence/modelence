import { AppConfig, ConfigKey, ConfigSchema } from './types';

let configSchema: ConfigSchema = {};
let config: Record<ConfigKey, AppConfig> = {};
let isInitialized = false;

/**
 * @sidebarTitle getConfig (server)
 *
 * @param key - The configuration key to retrieve
 * @returns The configuration value (string, number, or boolean)
 *
 * @example
 * ```ts
 * import { getConfig } from 'modelence/server';
 *
 * // Get the site URL
 * const siteUrl = getConfig('_system.site.url');
 * ```
 *
 * Set via environment variable:
 * ```bash
 * MODELENCE_SITE_URL=https://myapp.com
 * ```
 *
 * @example
 * ```ts
 * import { getConfig } from 'modelence/server';
 *
 * // Get the current environment (e.g., 'development', 'staging', 'production')
 * const env = getConfig('_system.env');
 *
 * if (env === 'production') {
 *   // Enable production features
 * }
 * ```
 *
 * Set via environment variable:
 * ```bash
 * MODELENCE_SITE_ENV=production
 * ```
 */
export function getConfig(key: ConfigKey) {
  return config[key]?.value ?? configSchema[key]?.default;
}

export function getPublicConfigs() {
  if (!isInitialized) {
    throw new Error(
      'Config is not initialized: an attempt was made to access configs before they were loaded'
    );
  }

  return Object.fromEntries(
    Object.entries(configSchema)
      .filter(([_, schema]) => schema.isPublic)
      .map(([key, schema]) => {
        return [
          key,
          {
            key,
            type: schema.type,
            value: config[key]?.value ?? schema.default,
          },
        ];
      })
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
      value,
    };
  });

  isInitialized = true;
}

export function getSchema() {
  return configSchema;
}

export function setSchema(schema: ConfigSchema) {
  // TODO: more validation on the schema structure
  Object.entries(schema).forEach(([key, value]) => {
    const { type, isPublic } = value;

    if (type === 'secret' && isPublic) {
      throw new Error(`Config ${key} with type "secret" cannot be public`);
    }
  });

  configSchema = schema;
}
