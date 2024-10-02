import { time } from '../time';
import { fetchConfigs } from '../app/backendApi';
let isSyncing = false;

const SYNC_INTERVAL = time.seconds(10);

export function startConfigSync() {
  setInterval(async() => {
    if (isSyncing) {
      return;
    }
  
    isSyncing = true;
  
    try {
      await syncConfig();
    } catch (error) {
      // TODO: send modelence logs also
      console.error('Error syncing config', error);
    }
  
    isSyncing = false;  
  }, SYNC_INTERVAL);
}

async function syncConfig() {
  console.log('syncing config');
  const configs = await fetchConfigs();
  console.log('configs fetched', configs);
}
