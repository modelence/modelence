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

export interface DeployTarget {
  environmentId: string;
  appAlias: string;
  envAlias: string;
}

export interface ProjectFile {
  appId?: string;
  deploy?: DeployTarget;
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
  patch: Partial<ProjectFile>,
  cwd = process.cwd()
): Promise<void> {
  const existing = await readProject(cwd);
  await fs.mkdir(join(cwd, MODELENCE_DIR), { recursive: true });
  await fs.writeFile(
    getProjectFilePath(cwd),
    JSON.stringify({ ...existing, ...patch }, null, 2) + '\n'
  );
}
