import { loadModels } from '../data/dataSources';
import { loadModules } from '../load';
import { _createMethodInternal } from '../methods';
import { getPublicConfigs } from '../config/server';

export async function initModules() {
  await initSystemMethods();

  await loadModels();
  await loadModules('**/*(.actions|actions).{js,ts}');
  await loadModules('**/*(.loaders|loaders).{js,ts}');
}

async function initSystemMethods() {
  _createMethodInternal('effect', '_system.initSession', async function(args, { session, user }) {
    // TODO: mark or track app load somewhere

    return {
      session,
      user,
      configs: getPublicConfigs(),
    };
  });

  _createMethodInternal('effect', '_system.sessionHeartbeat', async function(args, { session }) {
    
    // TODO: update session last active timestamp
    console.log('session heartbeat');
  });
}
