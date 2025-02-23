import { createJiti } from 'jiti';
import { parse as parseDotenv } from 'dotenv';
import { join } from 'path';
import fs from 'fs/promises';
import { ModelenceConfig } from '../packages/types';
import { z } from 'zod';

let env: Record<string, string> | null = null;
let config: ModelenceConfig | null = null;

export function getEnv() {
  if (!env) {
    throw new Error('Environment variables not loaded');
  }

  return env;
}

export function getConfig() {
  if (!config) {
    throw new Error('Configuration not loaded');
  }

  return config;
}

export function getStudioUrl(path: string) {
  const studioBaseUrl = getEnv().MODELENCE_SERVICE_ENDPOINT;
  if (!studioBaseUrl) {
    throw new Error('MODELENCE_SERVICE_ENDPOINT not found in environment variables');
  }

  return `${studioBaseUrl}${path}`;
}

export function getServerPath() {
  const { serverDir, serverEntry } = getConfig();
  return join(serverDir, serverEntry);
}

export async function loadEnv() {
  try {
    const configPath = join(process.cwd(), 'modelence.config.ts');

    const jiti = createJiti(import.meta.url, {
      interopDefault: true,
      requireCache: false
    });
    
    const configModule = await jiti.import(configPath);
    if (typeof configModule !== 'object') {
      throw new Error('modelence.config.ts should export an object');
    }
    config = z.object({
      serverDir: z.string(),
      serverEntry: z.string()
    }).parse(configModule);
  } catch (error) {
    console.error(error);
    throw new Error('Unable to load modelence.config.ts');
  }

  try {
    const envContent = await fs.readFile(join(process.cwd(), '.modelence.env'), 'utf-8');
    env = parseDotenv(envContent);    
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      // .modelence.env is optional, may not exist in case of an offline setup
    } else {
      throw error;
    }
  }
}
