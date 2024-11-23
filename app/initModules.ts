import { z } from 'zod';

import { loadModels } from '../data/dataSources';
import { loadModules } from '../load';
import { _createMethodInternal } from '../methods';
import { getPublicConfigs } from '../config/server';
import { fetchSessionByToken } from '../auth';

export async function initModules() {
  await initSystemMethods();

  await loadModels();
  await loadModules('**/*(.actions|actions).{js,ts}');
  await loadModules('**/*(.loaders|loaders).{js,ts}');
}

async function initSystemMethods() {
  _createMethodInternal('query', '_system.initSession', async function(args, context) {
    const { session, user } = await fetchSessionByToken(context.authToken);

    return {
      session,
      user,
      configs: getPublicConfigs(),
    };
  });

  _createMethodInternal('effect', '_system.sessionHeartbeat', async function(args, context) {
  });
}
