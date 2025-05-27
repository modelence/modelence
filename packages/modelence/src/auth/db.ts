import { schema } from '../data/types';
import { Store } from '../data/store';

export const usersCollection = new Store('_modelenceUsers', {
  schema: {
    handle: schema.string(),
    emails: schema.array(schema.object({
      address: schema.string(),
      verified: schema.boolean(),
    })).optional(),
    createdAt: schema.date(),
    authMethods: schema.object({
      password: schema.object({
        hash: schema.string(),
      }).optional(),
      google: schema.object({
        id: schema.string(),
      }).optional(),
    }),
  },
  indexes: [
    {
      key: { handle: 1 },
      unique: true,
      collation: { locale: 'en', strength: 2 }  // Case-insensitive
    },
  ]
});
