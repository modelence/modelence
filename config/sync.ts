import { time } from '../time';
import { fetchConfigs, syncStatus } from '../app/backendApi';
import { loadConfigs } from './server';

let isSyncing = false;

const SYNC_INTERVAL = time.seconds(10);

export function startConfigSync() {
  setInterval(async() => {
    if (isSyncing) {
      return;
    }
  
    isSyncing = true;

    // TODO: move this sync outside of config
    try {
      await syncStatus();
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

async function syncConfig() {
  const { configs } = await fetchConfigs();
  loadConfigs(configs);
}
