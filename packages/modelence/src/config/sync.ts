import { time } from '../time';
import { fetchConfigs, syncStatus } from '../app/backendApi';
import { isDevRuntime } from '../app/instance';
import { getLocalConfigs } from './local';
import { loadConfigs, getSchema } from './server';
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
      const sync = await syncStatus();
      // Another instance took over this environment. The dev-runtime guard
      // makes sure a Studio bug can never take down cloud containers.
      if (sync?.status === 'detached' && isDevRuntime()) {
        console.error(
          `Detached from Modelence Cloud: ${sync.message ?? 'this environment is now connected from another instance.'}`
        );
        process.exit(1);
      }
    } catch (error) {
      console.error('Error syncing status', error);
    }

    try {
      await syncConfig();
    } catch (error) {
      console.error('Error syncing config', error);
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
