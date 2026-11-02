import { promises as fs } from 'fs';
import { join } from 'path';
import { parse as parseDotenv } from 'dotenv';
import { readCachedToken, writeCachedToken } from './authCache';
import type { CliAuthTarget } from './auth';
import { DEFAULT_HOST, updateProject, withHostProject } from './project';
import { StudioApiError } from './studioApi';

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

export async function rememberTarget(target: CliAuthTarget, host: string) {
  const { appId, environmentId, appAlias, envAlias } = target;
  try {
    await updateProject((project) =>
      withHostProject(project, host, { appId, deploy: { environmentId, appAlias, envAlias } })
    );
  } catch (error) {
    console.warn('Could not record the deploy target in .modelence/project.json:', error);
  }
}

/*
  A host as typed (`--host hayk.modelence.dev`, or the same in
  MODELENCE_SERVICE_ENDPOINT) as the base URL requests go to: https:// when no
  scheme is given, since fetch refuses a URL without one, and no trailing
  slash. A path is kept, for a Studio served under a prefix.
*/
export function normalizeHost(host: string): string {
  const trimmed = host.trim().replace(/\/+$/, '');
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const url = URL.canParse(withScheme) ? new URL(withScheme) : null;
  // A mistyped scheme ("htps://") parses, with an opaque "null" origin.
  if (!url || (url.protocol !== 'https:' && url.protocol !== 'http:')) {
    throw new Error(`Invalid Modelence host "${host}"; expected e.g. https://cloud.modelence.com`);
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
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

/*
  A MODELENCE_TOKEN from the environment (CI) is only sent to a Studio the
  environment chose too. .modelence.env is a file in the checkout, and a
  repository that commits one pointing elsewhere would otherwise receive the
  token on the first deploy. A cached token is per host, so it never leaks
  this way.
*/
export function assertEnvTokenHost(flag: string | undefined, host: string) {
  if (
    !process.env.MODELENCE_TOKEN ||
    flag ||
    process.env.MODELENCE_SERVICE_ENDPOINT ||
    host === DEFAULT_HOST
  ) {
    return;
  }
  throw new Error(
    `Refusing to send MODELENCE_TOKEN to ${host}, which comes from .modelence.env. ` +
      `Pass --host ${host} or set MODELENCE_SERVICE_ENDPOINT if that is the Studio to deploy to.`
  );
}
