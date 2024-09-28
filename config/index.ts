import { isServer } from '../utils';
import { getConfig as getServerConfig} from './server';
import { getConfig as getClientConfig } from './client';

import { ConfigKey, ConfigSchema } from './types';

export type { ConfigSchema };

export function getConfig(key: ConfigKey) {
  return isServer() ? getServerConfig(key) : getClientConfig(key);
}
