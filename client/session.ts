import { callLoader } from './loader';
import { ConfigKey, AppConfig } from '../config/types';
import { _setConfig } from '../config/client';

type Configs = Record<ConfigKey, AppConfig>;

export async function initSession() {
  const { configs, session } = await callLoader<{ configs: Configs, session: object }>('_system.initSession');
  _setConfig(configs);
  localStorage.setItem('modelence.session', JSON.stringify(session));
}
