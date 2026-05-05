import { AppConfig, ConfigKey, Configs } from './types';

let config: Record<ConfigKey, AppConfig> = {};

type SsrConfigResolver = (key: ConfigKey) => string | number | boolean | undefined;
let ssrConfigResolver: SsrConfigResolver | null = null;

/**
 * @internal
 * Installed once by the SSR runtime. The resolver reads per-request configs
 * from AsyncLocalStorage, so this single global is safe under concurrency.
 */
export function _setSsrConfigResolver(resolver: SsrConfigResolver | null) {
  ssrConfigResolver = resolver;
}

/**
 * @sidebarTitle getConfig (client)
 *
 * @param key
 * @returns
 */
export function getConfig(key: ConfigKey): string | number | boolean | undefined {
  if (typeof window === 'undefined' && ssrConfigResolver) {
    return ssrConfigResolver(key);
  }
  return config[key]?.value;
}

export function _setConfig(configs: Configs) {
  config = configs;
}
