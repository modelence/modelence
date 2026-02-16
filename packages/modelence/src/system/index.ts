import { Module } from '../app/module';

export default new Module('_system', {
  configSchema: {
    mongodbUri: {
      type: 'secret',
      isPublic: false,
      default: '',
    },
    env: {
      type: 'string',
      isPublic: true,
      default: '',
    },
    'site.url': {
      type: 'string',
      isPublic: true,
      default: '',
    },
  },
});
