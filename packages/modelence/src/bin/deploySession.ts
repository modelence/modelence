import { promises as fs } from 'fs';
import { join } from 'path';
import { parse as parseDotenv } from 'dotenv';
import { readCachedToken, writeCachedToken } from './authCache';
import type { CliAuthTarget } from './auth';
import { updateProject, type DeployTarget, type ProjectFile } from './project';
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

export async function rememberTarget(target: CliAuthTarget | DeployTarget, host: string) {
  const deploy: DeployTarget = {
    environmentId: target.environmentId,
    appAlias: target.appAlias,
    envAlias: target.envAlias,
    host,
  };
  try {
    await updateProject({ deploy, ...('appId' in target ? { appId: target.appId } : {}) });
  } catch (error) {
    console.warn('Could not record the deploy target in .modelence/project.json:', error);
  }
}

/*
  The project file as it applies to this host. Ids and aliases only exist on
  the Studio they were picked on, so a target recorded for another one (a
  staging or personal Studio, say) is left out, and the picker opens instead
  of the deploy failing with "Environment not found".
*/
export function projectForHost(project: ProjectFile, host: string): ProjectFile {
  if (!project.deploy || (project.deploy.host ?? DEFAULT_HOST) === host) {
    return project;
  }
  const { deploy: _deploy, appId: _appId, ...rest } = project;
  return rest;
}

/*
  A host as typed (`--host hayk.modelence.dev`, or the same in
  MODELENCE_SERVICE_ENDPOINT) as the origin requests go to: https:// when no
  scheme is given, since fetch refuses a URL without one, and no trailing slash.
*/
export function normalizeHost(host: string): string {
  const trimmed = host.trim().replace(/\/+$/, '');
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    return new URL(withScheme).origin;
  } catch {
    throw new Error(`Invalid Modelence host "${host}"; expected e.g. https://cloud.modelence.com`);
  }
}

// The Studio host: flag → environment → the project's .modelence.env → default.
// Read directly rather than through loadEnv(), which requires a
// modelence.config.ts that plain Node.js projects don't have.
export async function resolveHost(flag: string | undefined, cwd: string): Promise<string> {
  if (flag) {
    return normalizeHost(flag);
  }
  if (process.env.MODELENCE_SERVICE_ENDPOINT) {
    return normalizeHost(process.env.MODELENCE_SERVICE_ENDPOINT);
  }
  let env: Record<string, string> = {};
  try {
    env = parseDotenv(await fs.readFile(join(cwd, '.modelence.env'), 'utf8'));
  } catch {
    // No .modelence.env — plain Node.js projects usually have none.
  }
  return env.MODELENCE_SERVICE_ENDPOINT
    ? normalizeHost(env.MODELENCE_SERVICE_ENDPOINT)
    : DEFAULT_HOST;
}
