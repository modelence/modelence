import { Store } from '../data/store';
import { schema } from '../data/types';

export const dbRateLimits = new Store('_modelenceRateLimits', {
  schema: {
    bucket: schema.string(),
    type: schema.enum(['ip', 'user']),
    value: schema.string(),
    
    currentWindowStart: schema.date(),
    currentWindowCount: schema.number(),
    previousWindowCount: schema.number(),
  },
  indexes: [
    {
      key: { bucket: 1, type: 1, value: 1 },
      unique: true
    }
  ]
});
