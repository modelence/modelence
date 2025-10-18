import { Module } from '../app/module';

export default new Module('_system.site', {
  configSchema: {
    url: {
      type: 'string',
      isPublic: true,
      default: '',
    },
  },
});
