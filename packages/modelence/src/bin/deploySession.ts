import { promises as fs } from 'fs';
import { join } from 'path';
import { parse as parseDotenv } from 'dotenv';
import { readCachedToken, writeCachedToken } from './authCache';
import type { CliAuthTarget } from './auth';
import { updateProject, type DeployTarget } from './project';
import { StudioApiError } from './studioApi';

const DEFAULT_HOST = 'https://cloud.modelence.com';

// The token in use, shared so a re-authorization mid-deploy reaches every
// later request without threading a new value through each call.
export interface Session {
  host: string;
  token: string;
}

export function isUnauthorized(error: unknown): boolean {
  return error instanceof StudioApiError && error.status === 401;
}

export async function resolveToken(host: string): Promise<string | null> {
  if (process.env.MODELENCE_TOKEN) {
    return process.env.MODELENCE_TOKEN;
  }
  return await readCachedToken(host);
}

export async function rememberToken(host: string, token: string, expiresAt?: string) {
  if (!expiresAt) {
    // Older Studio: the token lasts an hour, not worth caching.
    return;
  }
  try {
    await writeCachedToken(host, token, expiresAt);
  } catch (error) {
    console.warn('Could not save the login for next time:', error);
  }
}

export async function rememberTarget(target: CliAuthTarget | DeployTarget) {
  const deploy: DeployTarget = {
    environmentId: target.environmentId,
    appAlias: target.appAlias,
    envAlias: target.envAlias,
  };
  try {
    await updateProject({ deploy, ...('appId' in target ? { appId: target.appId } : {}) });
  } catch (error) {
    console.warn('Could not record the deploy target in .modelence/project.json:', error);
  }
}

// The Studio host: flag → environment → the project's .modelence.env → default.
// Read directly rather than through loadEnv(), which requires a
// modelence.config.ts that plain Node.js projects don't have.
export async function resolveHost(flag: string | undefined, cwd: string): Promise<string> {
  if (flag) {
    return flag.replace(/\/$/, '');
  }
  if (process.env.MODELENCE_SERVICE_ENDPOINT) {
    return process.env.MODELENCE_SERVICE_ENDPOINT.replace(/\/$/, '');
  }
  try {
    const env = parseDotenv(await fs.readFile(join(cwd, '.modelence.env'), 'utf8'));
    if (env.MODELENCE_SERVICE_ENDPOINT) {
      return env.MODELENCE_SERVICE_ENDPOINT.replace(/\/$/, '');
    }
  } catch {
    // No .modelence.env — plain Node.js projects usually have none.
  }
  return DEFAULT_HOST;
}
