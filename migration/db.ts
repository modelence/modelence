import { Store } from '../data/store';
import { schema } from '../data/types';

export const dbMigrations = new Store('_modelenceMigrations', {
  schema: {
    version: schema.number(),
    appliedAt: schema.date(),
  },
  indexes: [
    { key: { version: 1 }, unique: true },
  ],
});
