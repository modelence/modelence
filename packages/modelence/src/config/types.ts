/**
 * The available types for module configuration values.
 *
 * - `'string'` — A short text value (single line)
 * - `'text'` — A longer text value (multi-line)
 * - `'number'` — A numeric value
 * - `'boolean'` — A true/false toggle
 * - `'secret'` — A sensitive string value (e.g. API keys, tokens). Masked in the Cloud dashboard and cannot be marked as `isPublic`.
 */
export type ConfigType = 'text' | 'string' | 'number' | 'boolean' | 'secret';

export type ConfigKey = string;

export type ValueType<T extends ConfigType = ConfigType> = T extends 'number'
  ? number
  : T extends 'string'
    ? string
    : T extends 'text'
      ? string
      : T extends 'boolean'
        ? boolean
        : T extends 'secret'
          ? string
          : never;

/**
 * Defines a single configuration field within a module's `configSchema`.
 *
 * @example
 * ```ts
 * {
 *   type: 'secret',
 *   default: '',
 *   isPublic: false,
 * }
 * ```
 */
export type ConfigParams<T extends ConfigType = ConfigType, IsPublic extends boolean = boolean> = {
  /** The data type of this configuration value. */
  type: T;
  /** The default value used when no value has been set. */
  default: ValueType<T>;
  /**
   * Whether this config value is accessible on the client via `getConfig()` from `modelence/client`.
   *
   * Config values with `type: 'secret'` cannot be public.
   */
  isPublic: IsPublic;
};

export type AppConfig = {
  key: ConfigKey;
  value: ValueType<ConfigType>;
  type: ConfigType;
};

/**
 * Defines the configuration schema for a module. Each key becomes a namespaced
 * config value accessible via `getConfig('moduleName.key')`.
 *
 * @example
 * ```ts
 * import { Module } from 'modelence/server';
 *
 * export default new Module('payments', {
 *   configSchema: {
 *     apiKey: {
 *       type: 'secret',
 *       default: '',
 *       isPublic: false,
 *     },
 *     currency: {
 *       type: 'string',
 *       default: 'USD',
 *       isPublic: true,
 *     },
 *   },
 * });
 * ```
 */
export type ConfigSchema = {
  [key: string]: ConfigParams;
};

export type Configs = Record<ConfigKey, AppConfig>;
