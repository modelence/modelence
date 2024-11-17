import { callLoader } from './loader';
import { ConfigKey, AppConfig } from '../config/types';
import { _setConfig } from '../config/client';

type Configs = Record<ConfigKey, AppConfig>;

export async function initSession() {
  const existingSession = getLocalStorageSession();
  const { configs, session, user } = await callLoader<{ configs: Configs, session: object, user: object }>('_system.initSession', {
    authToken: existingSession?.authToken,
  });
  _setConfig(configs);
  localStorage.setItem('modelence.session', JSON.stringify(session));
  console.log('user', user);
}

function getLocalStorageSession() {
  const sessionJson = localStorage.getItem('modelence.session');
  try {
    return sessionJson ? JSON.parse(sessionJson) : null;
  } catch (e) {
    console.error('Error parsing session from localStorage', e);
    return null;
  }
}
