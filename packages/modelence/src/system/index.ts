import { Module } from '../app/module';

export default new Module('_system', {
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
