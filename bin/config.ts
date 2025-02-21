import { parse as parseDotenv } from 'dotenv';
import { join } from 'path';
import fs from 'fs/promises';

let env: Record<string, string> | null = null;

export function getEnv() {
  if (!env) {
    throw new Error('Environment variables not loaded');
  }

  return env;
}

export function getStudioUrl(path: string) {
  const studioBaseUrl = getEnv().MODELENCE_SERVICE_ENDPOINT;
  if (!studioBaseUrl) {
    throw new Error('MODELENCE_SERVICE_ENDPOINT not found in environment variables');
  }

  return `${studioBaseUrl}${path}`;
}

export async function loadEnv() {
  try {
    const envContent = await fs.readFile(join(process.cwd(), '.modelence.env'), 'utf-8');
    env = parseDotenv(envContent);    
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error('.modelence.env file not found in current directory');
    }
    throw error;
  }
}
