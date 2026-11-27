import type { AppRef } from './authCache';
import {
  assertEnvTokenHost,
  isUnauthorized,
  rememberApp,
  resolveHost,
  resolveLogin,
} from './deploySession';
import { describeOtherHosts, resolveTargetFromOptions, type CliTarget } from './deployTarget';
import { otherAppHosts, projectForHost, readProject, type HostProject } from './project';
import { signIn, signInAgain } from './signIn';
import { StudioApiError, studioRequest } from './studioApi';
import { isCI } from './terminal';

/*
  What the commands that work on a deployed environment share (`status`,
  `logs`, `builds`, `env`, `restart`): which environment, and a login to use
  it with. The environment is always named with --env, never picked for the
  user; the app can come from .modelence/project.json. The login is the
  app's, shared with `modelence deploy`, asked for in the browser when there
  is none or Studio says it doesn't cover what the command does.
*/

export interface EnvironmentOptions {
  app?: string;
  env?: string;
  host?: string;
}

export interface EnvironmentSession {
  host: string;
  get<T>(path: string, query?: Record<string, string | number>): Promise<T>;
  post<T>(path: string, body?: object): Promise<T>;
}

// A command takes seconds, unlike a deploy, so a login is usable to its last minute.
const EXPIRY_MARGIN_MS = 60 * 1000;

// The app as the command names it: --app, else the one in .modelence/project.json.
export function appRefFor(options: { app?: string }, project: HostProject): AppRef {
  return options.app ? { appAlias: options.app } : { appId: project.appId };
}

export function resolveEnvironmentTarget(
  options: EnvironmentOptions,
  project: HostProject,
  otherHosts: string[]
): CliTarget {
  if (options.env && (options.app || project.appId)) {
    const target = resolveTargetFromOptions(options, project, otherHosts);
    if (target) {
      return target;
    }
  }
  const needed = [
    options.env ? null : '--env <environment>',
    options.app || project.appId ? null : '--app <app>',
  ].filter(Boolean);
  const hostNote =
    !options.app && otherHosts.length > 0 ? ` Note: ${describeOtherHosts(otherHosts)}` : '';
  throw new Error(`Pass ${needed.join(' and ')} to say where.${hostNote}`);
}

export async function openEnvironment(options: EnvironmentOptions): Promise<EnvironmentSession> {
  const cwd = process.cwd();
  const host = await resolveHost(options.host, cwd);
  assertEnvTokenHost(options.host, host);
  const savedProject = await readProject(cwd);
  const project = projectForHost(savedProject, host);
  const otherHosts = project.appId ? [] : otherAppHosts(savedProject, host);
  const target = resolveEnvironmentTarget(options, project, otherHosts);

  const app = appRefFor(options, project);
  const envAlias = options.env;
  // A token from the environment can't be replaced by signing in again.
  const canSignIn = !isCI() && !process.env.MODELENCE_TOKEN;
  let token = (await resolveLogin(host, app, EXPIRY_MARGIN_MS))?.token ?? null;
  if (!token) {
    if (!canSignIn) {
      throw new Error('CI runs never open the browser to sign in. Set MODELENCE_TOKEN.');
    }
    const login = await signIn(host, { app, envAlias });
    token = login.token;
    if (!project.appId) {
      await rememberApp(login.appId, host);
    }
  }

  const request = async <T>(
    path: string,
    options: { method?: 'GET' | 'POST'; query?: Record<string, string | number>; body?: object }
  ): Promise<T> => {
    const send = () =>
      studioRequest<T>(host, path, { ...options, token: token ?? undefined }).catch(explain);
    try {
      return await send();
    } catch (error) {
      if (!isUnauthorized(error)) {
        throw error;
      }
      token = await signInAgain(host, {
        app,
        envAlias,
        canSignIn,
        reason: error instanceof Error ? error.message : undefined,
        refusal: 'Set a MODELENCE_TOKEN that covers this environment.',
      });
      return await send();
    }
  };

  return {
    host,
    get: (path, query = {}) => request(path, { query: { ...target, ...query } }),
    post: (path, body = {}) => request(path, { method: 'POST', body: { ...target, ...body } }),
  };
}

// A Studio without these routes answers with its web page, or a bare 404.
function explain(error: unknown): never {
  const isMissingRoute = error instanceof StudioApiError && error.status === 404 && !error.isJson;
  if (isMissingRoute || error instanceof SyntaxError) {
    throw new Error('This Modelence Studio does not support this command yet.');
  }
  throw error;
}
