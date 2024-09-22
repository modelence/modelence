import { loadModels } from '../data/dataSources';
import { loadModules } from '../load';

export async function initModules() {
  await loadModels();
  await loadModules('**/*(.actions|actions).{js,ts}');
  await loadModules('**/*(.loaders|loaders).{js,ts}');
}
