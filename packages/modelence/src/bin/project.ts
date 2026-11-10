import { promises as fs } from 'fs';
import { join } from 'path';

export const MODELENCE_DIR = '.modelence';
export const PROJECT_FILE = 'project.json';

/*
  .modelence/project.json — CLI-managed project state that is meant to be
  committed (unlike .modelence.env, which holds per-developer credentials).
  It records which app the project belongs to and nothing environment
  specific: the same code is deployed to several environments (staging,
  production), so the environment is picked in the browser or named with
  --env on every deploy. It is a hint, never a credential: access is
  re-checked on every request with the user's token.

  Earlier CLIs also saved the last deploy target under `deploy`. It is
  ignored when read and dropped the next time the file is written.
*/

export const DEFAULT_HOST = 'https://cloud.modelence.com';

// What the file records for one Studio. Ids only exist on the Studio they
// were picked on.
export interface HostProject {
  appId?: string;
}

/*
  Modelence Cloud keeps the top-level appId, the shape released CLIs read.
  Every other Studio (staging, a personal one) gets its own entry under
  `hosts`, keyed by its normalized host.
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

function asHostProject(value: unknown): HostProject {
  if (!value || typeof value !== 'object') {
    return {};
  }
  const { appId } = value as HostProject;
  return typeof appId === 'string' && appId ? { appId } : {};
}

export function projectForHost(project: ProjectFile, host: string): HostProject {
  if (host === DEFAULT_HOST) {
    return asHostProject(project);
  }
  return asHostProject(project.hosts?.[host]);
}

// Other Studios this project has an app for, to explain why none applies to
// the host in use.
export function otherAppHosts(project: ProjectFile, host: string): string[] {
  const hosts = Object.keys(project.hosts ?? {}).filter(
    (key) => asHostProject(project.hosts?.[key]).appId
  );
  if (asHostProject(project).appId) {
    hosts.unshift(DEFAULT_HOST);
  }
  return [...new Set(hosts)].filter((key) => key !== host);
}

// The file with `patch` recorded for `host`, and that host's legacy deploy
// target dropped.
export function withHostProject(
  project: ProjectFile,
  host: string,
  patch: HostProject
): ProjectFile {
  if (host === DEFAULT_HOST) {
    return { ...withoutDeploy(project), ...patch };
  }
  return {
    ...project,
    hosts: {
      ...project.hosts,
      [host]: { ...withoutDeploy(project.hosts?.[host] ?? {}), ...patch },
    },
  };
}

function withoutDeploy<T extends object>(entry: T): T {
  const { deploy: _legacy, ...rest } = entry as T & { deploy?: unknown };
  return rest as T;
}
