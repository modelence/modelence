import { Module } from '../app/module';
import { isSetupRequired } from '../app/setupStatus';

export default new Module('_system', {
  queries: {
    /*
      Polled by the built-in setup screen (dev only) so it can dismiss itself
      once the project is connected and the dev server restarted. Public and
      unauthenticated by design — it exposes a single boolean that is always
      false outside development.
    */
    setupStatus: async () => ({ setupRequired: isSetupRequired() }),
  },
  configSchema: {
    mongodbUri: {
      type: 'secret',
      isPublic: false,
      default: '',
    },
    mongodbPoolSize: {
      type: 'number',
      isPublic: false,
      default: 10,
    },
    'env.type': {
      type: 'string',
      isPublic: true,
      default: '',
    },
    'site.url': {
      type: 'string',
      isPublic: true,
      default: '',
    },
    multiInstance: {
      type: 'boolean',
      isPublic: false,
      default: false,
    },
  },
});
