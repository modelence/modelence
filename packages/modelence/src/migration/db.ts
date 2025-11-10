import { Store } from '../data/store';
import { schema } from '../data/types';

export const dbMigrations = new Store('_modelenceMigrations', {
  schema: {
    version: schema.number(),
    status: schema.enum(['completed', 'failed']),
    output: schema.string().optional(),
    appliedAt: schema.date(),
  },
  indexes: [{ key: { version: 1 }, unique: true }, { key: { version: 1, status: 1 } }],
});
