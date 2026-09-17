import { promises as fs } from 'fs';
import { join, relative, sep } from 'path';
import type { PackageManager } from './detect';

/*
  Monorepo detection. Two things a single-package project never needs:
  which pnpm major wrote the lockfile (so the build installs a compatible
  one), and which workspace package is the one to start.
*/

export interface WorkspacePackage {
  name: string;
  // Relative to the workspace root, POSIX separators.
  dir: string;
  scripts: Record<string, string>;
}

// pnpm-lock.yaml `lockfileVersion` → the pnpm major that reads it. 9.0 is
// written by pnpm 9 and 10 alike; 10 is picked because it reads both and
// only warns about unapproved build scripts where 11 fails.
const PNPM_MAJOR_BY_LOCKFILE: Record<string, number> = {
  '5': 7,
  '6': 8,
  '9': 10,
};

export function pnpmMajorFromLockfile(lockfileText: string): number | undefined {
  const match = /^lockfileVersion:\s*['"]?(\d+)(?:\.\d+)?['"]?\s*$/m.exec(lockfileText);
  if (!match) {
    return undefined;
  }
  return PNPM_MAJOR_BY_LOCKFILE[match[1]];
}

// The `packages:` list of pnpm-workspace.yaml. Only the flat "- glob" form
// pnpm documents is handled; anything else yields no globs.
export function parsePnpmWorkspaceGlobs(yamlText: string): string[] {
  const globs: string[] = [];
  let inPackages = false;
  for (const line of yamlText.split('\n')) {
    if (/^packages:\s*$/.test(line)) {
      inPackages = true;
      continue;
    }
    if (!inPackages) {
      continue;
    }
    const item = /^\s+-\s*['"]?([^'"#]+?)['"]?\s*(?:#.*)?$/.exec(line);
    if (item) {
      globs.push(item[1].trim());
    } else if (line.trim() !== '' && !line.startsWith(' ') && !line.startsWith('\t')) {
      inPackages = false;
    }
  }
  return globs;
}

// package.json `workspaces`: an array, or yarn's `{ packages: [...] }`.
export function parsePackageJsonWorkspaces(packageJson: Record<string, unknown>): string[] {
  const field = packageJson.workspaces;
  if (Array.isArray(field)) {
    return field.filter((entry): entry is string => typeof entry === 'string');
  }
  if (field && typeof field === 'object') {
    const packages = (field as { packages?: unknown }).packages;
    return Array.isArray(packages)
      ? packages.filter((entry): entry is string => typeof entry === 'string')
      : [];
  }
  return [];
}

function globToRegExp(glob: string): RegExp {
  const normalized = glob.replace(/\\/g, '/').replace(/\/+$/, '');
  const pattern = normalized
    .split('/')
    .map((segment) => {
      if (segment === '**') {
        return '.*';
      }
      return segment.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*');
    })
    .join('/');
  return new RegExp(`^${pattern}$`);
}

async function listPackageDirs(root: string, maxDepth: number): Promise<string[]> {
  const found: string[] = [];
  async function walk(dir: string, depth: number) {
    if (depth > maxDepth) {
      return;
    }
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === 'node_modules' || entry.name.startsWith('.')) {
        continue;
      }
      const full = join(dir, entry.name);
      found.push(full);
      await walk(full, depth + 1);
    }
  }
  await walk(root, 1);
  return found;
}

const MAX_WORKSPACE_DEPTH = 4;

// Workspace members: directories under the root matching the globs that
// hold a package.json. Negated globs ("!apps/legacy") exclude.
export async function findWorkspacePackages(
  root: string,
  globs: string[]
): Promise<WorkspacePackage[]> {
  if (globs.length === 0) {
    return [];
  }
  const include = globs.filter((glob) => !glob.startsWith('!')).map(globToRegExp);
  const exclude = globs
    .filter((glob) => glob.startsWith('!'))
    .map((glob) => globToRegExp(glob.slice(1)));
  const candidates = await listPackageDirs(root, MAX_WORKSPACE_DEPTH);
  const packages: WorkspacePackage[] = [];
  for (const dir of candidates) {
    const rel = relative(root, dir).split(sep).join('/');
    if (!include.some((re) => re.test(rel)) || exclude.some((re) => re.test(rel))) {
      continue;
    }
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(await fs.readFile(join(dir, 'package.json'), 'utf8'));
    } catch {
      continue;
    }
    if (typeof parsed.name !== 'string') {
      continue;
    }
    packages.push({
      name: parsed.name,
      dir: rel,
      scripts: (parsed.scripts ?? {}) as Record<string, string>,
    });
  }
  return packages.sort((a, b) => a.dir.localeCompare(b.dir));
}

export function workspaceStartCommand(packageManager: PackageManager, name: string): string {
  switch (packageManager) {
    case 'pnpm':
      return `pnpm --filter ${name} start`;
    case 'yarn':
      return `yarn workspace ${name} start`;
    default:
      return `npm start --workspace ${name}`;
  }
}

// Builds one member plus its workspace dependencies. pnpm's `name...` filter
// is the dependency closure; npm and yarn classic have no equivalent, so
// only the member itself is built there.
export function workspaceBuildCommand(
  packageManager: PackageManager,
  member: WorkspacePackage
): string | undefined {
  switch (packageManager) {
    case 'pnpm':
      return `pnpm --filter ${member.name}... --if-present run build`;
    case 'yarn':
      return member.scripts.build ? `yarn workspace ${member.name} run build` : undefined;
    default:
      return member.scripts.build
        ? `npm run build --if-present --workspace ${member.name}`
        : undefined;
  }
}

export interface WorkspaceStartDetection {
  startCommand?: string;
  buildCommand?: string;
  note?: string;
}

// Picks the workspace package to run when the root has no start script: the
// one member with a `start` script. Several candidates need a human choice.
export async function detectWorkspaceStart(
  cwd: string,
  packageManager: PackageManager,
  packageJson: Record<string, unknown>
): Promise<WorkspaceStartDetection> {
  let globs = parsePackageJsonWorkspaces(packageJson);
  if (packageManager === 'pnpm') {
    try {
      globs = parsePnpmWorkspaceGlobs(await fs.readFile(join(cwd, 'pnpm-workspace.yaml'), 'utf8'));
    } catch {
      // Not a pnpm workspace.
    }
  }
  const members = await findWorkspacePackages(cwd, globs);
  const startable = members.filter((member) => member.scripts.start);
  if (startable.length === 1) {
    const [member] = startable;
    return {
      startCommand: workspaceStartCommand(packageManager, member.name),
      buildCommand: workspaceBuildCommand(packageManager, member),
      note:
        `No root start script; the container starts the ${member.name} workspace package (${member.dir}/), ` +
        'and the build is scoped to it and its workspace dependencies. Pass --build-command to build differently.',
    };
  }
  if (startable.length > 1) {
    const names = startable.map((member) => member.name).join(', ');
    return {
      note: `Several workspace packages have a start script (${names}); pass --start-command to choose one.`,
    };
  }
  return {};
}
