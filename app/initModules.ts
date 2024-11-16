import { z } from 'zod';

import { loadModels } from '../data/dataSources';
import { loadModules } from '../load';
import { _createLoaderInternal } from '../data/loader';
import { getPublicConfigs } from '../config/server';
import { fetchSessionByToken } from './session';

export async function initModules() {
  await initSystemLoaders();

  await loadModels();
  await loadModules('**/*(.actions|actions).{js,ts}');
  await loadModules('**/*(.loaders|loaders).{js,ts}');
}

async function initSystemLoaders() {
  _createLoaderInternal('_system.initSession', async function(args) {
    const authToken = z.string().optional().parse(args.authToken);

    return {
      session: await fetchSessionByToken(authToken),
      configs: getPublicConfigs(),
    };
  });
}
