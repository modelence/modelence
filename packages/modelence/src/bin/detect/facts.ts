import { promises as fs } from 'fs';
import { join, relative, sep } from 'path';
import {
  globToRegExp,
  isLockfileInSync,
  parseNodeMajor,
  parsePackageJsonWorkspaces,
  parsePackageManagerVersion,
  parsePnpmWorkspaceGlobs,
  parseProcfileWebCommand,
  parseReplitModules,
  parseViteOutput,
  pnpmMajorFromLockfile,
  type PackageManager,
} from './parsers';

/*
  Everything detection may want to know about a project, read once. The
  detectors themselves are pure functions over this object, which keeps
  them trivially testable and keeps file access in one place.
*/

export interface WorkspaceMember {
  name: string;
  // Relative to the workspace root, POSIX separators.
  dir: string;
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
  hasViteConfig: boolean;
  // From the member's vite config when it could be read; undefined otherwise.
  viteOutDir?: string;
  viteOutputAmbiguous?: boolean;
}

export interface ProjectFacts {
  cwd: string;
  packageJson: Record<string, unknown>;
  scripts: Record<string, string>;
  // dependencies and devDependencies together: what the project uses.
  dependencies: Record<string, string>;
  nodeMajor?: string;
  packageManager: PackageManager;
  // The version pinned for the package manager: package.json's
  // `packageManager` field, else what the lockfile format implies.
  packageManagerVersion?: string;
  packageManagerNotes?: string[];
  lockfile: {
    present: boolean;
    // npm only: whether package-lock.json agrees with package.json.
    inSync: boolean;
  };
  procfileWeb?: string;
  hasModelenceConfig: boolean;
  hasIndexHtml: boolean;
  hasViteConfig: boolean;
  viteOutDir?: string;
  viteOutputAmbiguous?: boolean;
  // Present when the project came from Replit (.replit at the root).
  replit?: { modules: string[] };
  workspace: {
    globs: string[];
    members: WorkspaceMember[];
  };
}

function mergedDependencies(packageJson: Record<string, unknown>): Record<string, string> {
  return {
    ...((packageJson.dependencies ?? {}) as Record<string, string>),
    ...((packageJson.devDependencies ?? {}) as Record<string, string>),
  };
}

// Every package the project or one of its workspace members depends on.
export function allDependencies(facts: ProjectFacts): Record<string, string> {
  return Object.assign(
    {},
    facts.dependencies,
    ...facts.workspace.members.map((member) => member.dependencies)
  );
}

async function exists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

async function readText(path: string): Promise<string | null> {
  try {
    return await fs.readFile(path, 'utf8');
  } catch {
    return null;
  }
}

async function readJson(path: string): Promise<Record<string, unknown> | null> {
  const text = await readText(path);
  if (text === null) {
    return null;
  }
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

const VITE_CONFIG_NAMES = [
  'vite.config.ts',
  'vite.config.js',
  'vite.config.mts',
  'vite.config.mjs',
];

async function readViteConfig(
  dir: string
): Promise<{ present: boolean; outDir?: string; ambiguous?: boolean }> {
  for (const name of VITE_CONFIG_NAMES) {
    const text = await readText(join(dir, name));
    if (text !== null) {
      return { present: true, ...parseViteOutput(text) };
    }
  }
  return { present: false };
}

async function detectPackageManager(cwd: string, packageJson: Record<string, unknown>) {
  const [pnpmLock, yarnLock, npmLock] = await Promise.all([
    readText(join(cwd, 'pnpm-lock.yaml')),
    readText(join(cwd, 'yarn.lock')),
    readJson(join(cwd, 'package-lock.json')),
  ]);
  const available: PackageManager[] = [];
  if (pnpmLock !== null) available.push('pnpm');
  if (yarnLock !== null) available.push('yarn');
  if (npmLock !== null) available.push('npm');

  const declaration = packageJson.packageManager;
  const declared = typeof declaration === 'string' ? declaration.split('@')[0] : undefined;
  if (declared && !['npm', 'pnpm', 'yarn'].includes(declared)) {
    throw new Error(
      `Unsupported package manager "${declared}"; configure a supported package manager before deploying.`
    );
  }
  if (!declared && available.length > 1) {
    throw new Error(
      `Conflicting lockfiles (${available.join(', ')}); set packageManager in package.json or remove stale lockfiles.`
    );
  }
  const packageManager = (declared as PackageManager | undefined) ?? available[0] ?? 'npm';
  const pinned = parsePackageManagerVersion(declaration, packageManager);
  if (declared && !pinned) {
    throw new Error('packageManager must pin a version, for example "pnpm@10.4.1".');
  }
  const ignored = available.filter((manager) => manager !== packageManager);
  const packageManagerNotes = ignored.length
    ? [`Using declared ${packageManager}; ignoring ${ignored.join(', ')} lockfiles.`]
    : [];
  const major = pnpmLock === null ? undefined : pnpmMajorFromLockfile(pnpmLock);
  return {
    packageManager,
    packageManagerVersion:
      pinned ?? (packageManager === 'pnpm' && major ? String(major) : undefined),
    packageManagerNotes,
    lockfile: {
      present: available.includes(packageManager),
      inSync:
        packageManager === 'npm'
          ? npmLock !== null && isLockfileInSync(packageJson, npmLock)
          : available.includes(packageManager),
    },
  };
}

// Follow only declared workspace patterns. Literal prefixes avoid walking assets
// and build output; ** has no arbitrary depth cap. Symlink directories are skipped.
async function workspaceDirectories(root: string, globs: string[]): Promise<string[]> {
  const found = new Set<string>();
  const exclude = globs
    .filter((glob) => glob.startsWith('!'))
    .map((glob) => globToRegExp(glob.slice(1)));
  for (const glob of globs.filter((glob) => !glob.startsWith('!'))) {
    const parts = glob.replace(/^\.\//, '').replace(/\/+$/, '').split('/');
    if (parts.some((part) => part === '..') || glob.startsWith('/')) {
      throw new Error(`Workspace pattern must stay within the project: ${glob}`);
    }
    const visited = new Set<string>();
    async function walk(dir: string, index: number): Promise<void> {
      const key = `${dir}:${index}`;
      if (visited.has(key) || exclude.some((pattern) => pattern.test(dir))) return;
      visited.add(key);
      if (index === parts.length) {
        if (dir) found.add(join(root, dir));
        return;
      }
      const part = parts[index];
      if (part === '**') await walk(dir, index + 1);
      const entries = await fs.readdir(join(root, dir), { withFileTypes: true });
      const pattern = globToRegExp(part);
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name === 'node_modules' || entry.name.startsWith('.'))
          continue;
        if (part !== '**' && !pattern.test(entry.name)) continue;
        await walk(dir ? `${dir}/${entry.name}` : entry.name, part === '**' ? index : index + 1);
      }
    }
    await walk('', 0);
  }
  return [...found];
}

// Workspace members: directories under the root matching the globs that
// hold a package.json. Negated globs ("!apps/legacy") exclude.
export async function findWorkspaceMembers(
  root: string,
  globs: string[]
): Promise<WorkspaceMember[]> {
  if (globs.length === 0) {
    return [];
  }
  const include = globs.filter((glob) => !glob.startsWith('!')).map(globToRegExp);
  const exclude = globs
    .filter((glob) => glob.startsWith('!'))
    .map((glob) => globToRegExp(glob.slice(1)));
  const candidates = await workspaceDirectories(root, globs);
  const members: WorkspaceMember[] = [];
  for (const dir of candidates) {
    const rel = relative(root, dir).split(sep).join('/');
    if (!include.some((re) => re.test(rel)) || exclude.some((re) => re.test(rel))) {
      continue;
    }
    const packageJson = await readJson(join(dir, 'package.json'));
    if (!packageJson || typeof packageJson.name !== 'string') {
      continue;
    }
    const vite = await readViteConfig(dir);
    members.push({
      name: packageJson.name,
      dir: rel,
      scripts: (packageJson.scripts ?? {}) as Record<string, string>,
      dependencies: mergedDependencies(packageJson),
      hasViteConfig: vite.present,
      ...(vite.ambiguous ? { viteOutputAmbiguous: true } : {}),
      ...(vite.outDir ? { viteOutDir: vite.outDir } : {}),
    });
  }
  return members.sort((a, b) => a.dir.localeCompare(b.dir));
}

async function readWorkspaceGlobs(
  cwd: string,
  packageJson: Record<string, unknown>,
  packageManager: PackageManager
): Promise<string[]> {
  if (packageManager === 'pnpm') {
    const yaml = await readText(join(cwd, 'pnpm-workspace.yaml'));
    if (yaml !== null) {
      return parsePnpmWorkspaceGlobs(yaml);
    }
  }
  return parsePackageJsonWorkspaces(packageJson);
}

export async function gatherProjectFacts(cwd = process.cwd()): Promise<ProjectFacts> {
  const packageJson = await readJson(join(cwd, 'package.json'));
  if (!packageJson) {
    throw new Error('No package.json found in the current directory');
  }
  const engines = (packageJson.engines ?? {}) as Record<string, unknown>;
  const manager = await detectPackageManager(cwd, packageJson);
  const procfile = await readText(join(cwd, 'Procfile'));
  const vite = await readViteConfig(cwd);
  const replit = await readText(join(cwd, '.replit'));
  const globs = await readWorkspaceGlobs(cwd, packageJson, manager.packageManager);

  return {
    cwd,
    packageJson,
    scripts: (packageJson.scripts ?? {}) as Record<string, string>,
    dependencies: mergedDependencies(packageJson),
    nodeMajor: parseNodeMajor(engines.node),
    ...manager,
    procfileWeb: procfile === null ? undefined : parseProcfileWebCommand(procfile),
    hasModelenceConfig:
      (await exists(join(cwd, 'modelence.config.ts'))) ||
      (await exists(join(cwd, 'modelence.config.js'))),
    hasIndexHtml: await exists(join(cwd, 'index.html')),
    hasViteConfig: vite.present,
    viteOutDir: vite.outDir,
    ...(vite.ambiguous ? { viteOutputAmbiguous: true } : {}),
    ...(replit === null ? {} : { replit: { modules: parseReplitModules(replit) } }),
    workspace: { globs, members: await findWorkspaceMembers(cwd, globs) },
  };
}
