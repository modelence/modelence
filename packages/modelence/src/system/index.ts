import { Module } from '../app/module';

export default new Module('_system', {
  configSchema: {
    mongodbUrl: {
      type: 'string',
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
    'log.level': {
      type: 'string',
      isPublic: false,
      default: 'info',
    },
    
  },
});
