import type systemModule from './index';
import { createClientModule } from '../client/module';

export const systemConfig = createClientModule<typeof systemModule>('_system');
