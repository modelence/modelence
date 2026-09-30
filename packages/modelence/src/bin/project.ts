import { promises as fs } from 'fs';
import { join } from 'path';

export const MODELENCE_DIR = '.modelence';
export const PROJECT_FILE = 'project.json';

/*
  .modelence/project.json — CLI-managed project state that is meant to be
  committed (unlike .modelence.env, which holds per-developer credentials).
  It records which app the project belongs to and, once a deploy target has
  been picked in the browser, which environment `modelence deploy` ships to.
  Everything in it is a hint, never a credential: access is re-checked on
  every request with the user's token.
*/

export const DEFAULT_HOST = 'https://cloud.modelence.com';

export interface DeployTarget {
  environmentId: string;
  appAlias: string;
  envAlias: string;
  // Only in files written by pre-release CLIs, which kept one target for
  // whichever Studio was used last; absent means Modelence Cloud.
  host?: string;
}

// What the file records for one Studio. Ids and aliases only exist on the
// Studio they were picked on.
export interface HostProject {
  appId?: string;
  deploy?: DeployTarget;
}

/*
  Modelence Cloud keeps the top-level appId and deploy, the shape released
  CLIs read, so they keep deploying to Cloud. Every other Studio (staging, a
  personal one) gets its own entry under `hosts`, keyed by its normalized
  host, so deploying there never changes what a teammate or CI deploys to.
*/
export interface ProjectFile extends HostProject {
  hosts?: Record<string, HostProject>;
  [key: string]: unknown;
}

export function getProjectFilePath(cwd = process.cwd()): string {
  return join(cwd, MODELENCE_DIR, PROJECT_FILE);
}

// Missing or malformed reads as an empty project rather than failing the
// command: the file only ever pre-fills choices.
export async function readProject(cwd = process.cwd()): Promise<ProjectFile> {
  try {
    const content = await fs.readFile(getProjectFilePath(cwd), 'utf8');
    const parsed = JSON.parse(content);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export async function updateProject(
  update: (project: ProjectFile) => ProjectFile,
  cwd = process.cwd()
): Promise<void> {
  const next = update(await readProject(cwd));
  await fs.mkdir(join(cwd, MODELENCE_DIR), { recursive: true });
  await fs.writeFile(getProjectFilePath(cwd), JSON.stringify(next, null, 2) + '\n');
}

// The Studio the top-level target was picked on.
function topLevelHost(project: ProjectFile): string {
  return typeof project.deploy?.host === 'string' ? project.deploy.host : DEFAULT_HOST;
}

function asHostProject(value: unknown): HostProject {
  if (!value || typeof value !== 'object') {
    return {};
  }
  const { appId, deploy } = value as HostProject;
  return {
    ...(typeof appId === 'string' && appId ? { appId } : {}),
    ...(deploy && typeof deploy.environmentId === 'string' ? { deploy } : {}),
  };
}

export function projectForHost(project: ProjectFile, host: string): HostProject {
  // The top level is Modelence Cloud's, or — in a pre-release file — belongs
  // to the Studio its deploy.host names.
  const topLevel = topLevelHost(project) === host ? asHostProject(project) : {};
  if (host === DEFAULT_HOST) {
    return topLevel;
  }
  return { ...topLevel, ...asHostProject(project.hosts?.[host]) };
}

// Other Studios this project has a deploy target for, to explain why none
// applies to the host in use.
export function otherTargetHosts(project: ProjectFile, host: string): string[] {
  const hosts = Object.keys(project.hosts ?? {}).filter(
    (key) => asHostProject(project.hosts?.[key]).deploy
  );
  if (asHostProject(project).deploy) {
    hosts.unshift(topLevelHost(project));
  }
  return [...new Set(hosts)].filter((key) => key !== host);
}

/*
  The file with `patch` recorded for `host`. A pre-release file that holds
  another Studio's target at the top level has it moved under `hosts` first,
  so the top level is Modelence Cloud's again.
*/
export function withHostProject(
  project: ProjectFile,
  host: string,
  patch: HostProject
): ProjectFile {
  const base = liftTopLevelTarget(project);
  if (host === DEFAULT_HOST) {
    return { ...base, ...patch };
  }
  return { ...base, hosts: { ...base.hosts, [host]: { ...base.hosts?.[host], ...patch } } };
}

function liftTopLevelTarget(project: ProjectFile): ProjectFile {
  const legacyHost = topLevelHost(project);
  if (!project.deploy || legacyHost === DEFAULT_HOST) {
    return project;
  }
  // The top-level appId was written together with that target.
  const { deploy, appId, ...rest } = project;
  const { host: _host, ...target } = deploy;
  return {
    ...rest,
    hosts: { [legacyHost]: { appId, deploy: target }, ...project.hosts },
  };
}
