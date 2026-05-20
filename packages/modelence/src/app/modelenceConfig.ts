import { join } from 'path';
import { createJiti } from 'jiti';
import { z } from 'zod';
import type { ModelenceConfig } from '../types';

const configSchema = z.object({
  serverDir: z.string(),
  serverEntry: z.string(),
  postBuildCommand: z.string().optional(),
  ssr: z.boolean().optional(),
});

export async function loadModelenceConfig(): Promise<ModelenceConfig> {
  const configPath = join(process.cwd(), 'modelence.config.ts');

  const jiti = createJiti(import.meta.url, {
    interopDefault: true,
    requireCache: false,
  });

  const configModule = await jiti.import(configPath);
  if (typeof configModule !== 'object') {
    throw new Error('modelence.config.ts should export an object');
  }

  return configSchema.parse(configModule);
}
