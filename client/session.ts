import { callLoader } from './loader';
import { ConfigKey, AppConfig } from '../config/types';
import { _setConfig } from '../config/client';

export async function initSession() {
  const { configs } = await callLoader<{ configs: Record<ConfigKey, AppConfig> }>('_system.initSession');
  _setConfig(configs);
}
