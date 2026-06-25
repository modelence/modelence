import { AppConfig, ConfigKey, Configs } from './types';

let config: Record<ConfigKey, AppConfig> = {};

type SsrConfigResolver = (key: ConfigKey) => string | number | boolean | undefined;
let ssrConfigResolver: SsrConfigResolver | null = null;

/** @internal SSR resolver reads from AsyncLocalStorage (per-request scoped). */
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
