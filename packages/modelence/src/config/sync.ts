import { time } from '../time';
import { fetchConfigs, syncStatus } from '../app/backendApi';
import { getLocalConfigs } from './local';
import { loadConfigs, getSchema } from './server';
import { logError } from '../telemetry';
import { AppConfig } from './types';

let isSyncing = false;

const SYNC_INTERVAL = time.seconds(10);

export function startConfigSync() {
  setInterval(async () => {
    if (isSyncing) {
      return;
    }

    isSyncing = true;

    // TODO: move this sync outside of config
    try {
      await syncStatus();
    } catch (error) {
      logError('Config sync status failed', { error });
    }

    try {
      await syncConfig();
    } catch (error) {
      logError('Config sync failed', { error });
    }

    isSyncing = false;
  }, SYNC_INTERVAL);
}

export function loadRemoteConfigs(configs: AppConfig[]) {
  loadConfigs(configs);
  loadConfigs(getLocalConfigs(getSchema(), 'withRemoteServer'));
}

async function syncConfig() {
  const { configs } = await fetchConfigs();
  loadRemoteConfigs(configs);
}
