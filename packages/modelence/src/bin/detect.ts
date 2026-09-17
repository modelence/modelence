import { promises as fs } from 'fs';
import { join } from 'path';
import { detectWorkspaceStart, pnpmMajorFromLockfile } from './workspaces';

/*
  Infers the build contract from the project the way Heroku's Node buildpack
  does: the lockfile picks the package manager, package.json scripts pick the
  build and start commands, a Procfile `web:` line wins for start, and
  engines.node pins the Node.js major. Studio uses these as defaults for
  whatever the environment's settings leave blank.
*/

export type PackageManager = 'npm' | 'pnpm' | 'yarn';

export interface DetectedBuildPlan {
  preset: 'modelence' | 'node' | 'static';
  packageManager: PackageManager;
  nodeVersion?: string;
  installCommand: string;
  // Undefined when nothing was found, so the server's defaults apply.
  buildCommand?: string;
  startCommand?: string;
  // 'static' preset: where the build writes the site.
  outputDirectory?: string;
  // Human-readable notes about what was (not) found.
  notes: string[];
}

const MINIMUM_NODE_MAJOR = 18;

async function exists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

async function readJson(path: string): Promise<Record<string, unknown> | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(path, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

// The first version number in a semver range, e.g. ">=20.10 <23" → "20",
// "22.x" → "22". Anything below the supported floor is ignored.
export function parseNodeMajor(range: unknown): string | undefined {
  if (typeof range !== 'string') {
    return undefined;
  }
  const match = range.match(/(\d+)(?:\.\d+)?(?:\.\d+)?/);
  if (!match) {
    return undefined;
  }
  const major = Number(match[1]);
  return major >= MINIMUM_NODE_MAJOR ? String(major) : undefined;
}

export function parseProcfileWebCommand(content: string): string | undefined {
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*web\s*:\s*(.+?)\s*$/);
    if (match) {
      return match[1];
    }
  }
  return undefined;
}

/*
  `npm ci` refuses a package-lock.json that disagrees with package.json — a
  common state for generated projects (Lovable adds a dependency without
  refreshing the lock). Compares the root package's declared dependencies
  with the lock's root entry (lockfileVersion 2+). An old v1 lock has no root
  entry, so it is trusted as-is.
*/
export function isLockfileInSync(
  packageJson: Record<string, unknown>,
  lockfile: Record<string, unknown>
): boolean {
  const packages = lockfile.packages as Record<string, Record<string, unknown>> | undefined;
  const root = packages?.[''];
  if (!root) {
    return true;
  }
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies'] as const) {
    const declared = (packageJson[field] ?? {}) as Record<string, string>;
    const locked = (root[field] ?? {}) as Record<string, string>;
    const names = new Set([...Object.keys(declared), ...Object.keys(locked)]);
    for (const name of names) {
      if (declared[name] !== locked[name]) {
        return false;
      }
    }
  }
  return true;
}

// package.json `packageManager` ("pnpm@10.4.1+sha512...") → "10.4.1" when it
// names the given manager. Anything that is not a plain semver version is
// ignored rather than passed to npm.
export function parsePackageManagerVersion(
  field: unknown,
  manager: PackageManager
): string | undefined {
  if (typeof field !== 'string') {
    return undefined;
  }
  const match = /^([a-z]+)@(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)(?:\+.*)?$/.exec(field.trim());
  if (!match || match[1] !== manager) {
    return undefined;
  }
  return match[2];
}

function commandsFor(packageManager: PackageManager, hasLockfile: boolean, pinnedVersion?: string) {
  switch (packageManager) {
    case 'pnpm': {
      // Without a pin `npm install -g pnpm` picks whatever is latest, which
      // can be a major ahead of the lockfile and refuse the install.
      const pnpmPackage = pinnedVersion ? `pnpm@${pinnedVersion}` : 'pnpm';
      return {
        install: `npm install -g ${pnpmPackage} && pnpm install --frozen-lockfile`,
        run: (script: string) => `pnpm run ${script}`,
        start: 'pnpm start',
      };
    }
    case 'yarn':
      return {
        install: 'yarn install --frozen-lockfile',
        run: (script: string) => `yarn ${script}`,
        start: 'yarn start',
      };
    default:
      return {
        install: hasLockfile ? 'npm ci' : 'npm install',
        run: (script: string) => `npm run ${script}`,
        start: 'npm start',
      };
  }
}

export async function detectBuildPlan(cwd = process.cwd()): Promise<DetectedBuildPlan> {
  const notes: string[] = [];

  const packageJson = await readJson(join(cwd, 'package.json'));
  if (!packageJson) {
    throw new Error('No package.json found in the current directory');
  }
  const scripts = (packageJson.scripts ?? {}) as Record<string, string>;
  const engines = (packageJson.engines ?? {}) as Record<string, unknown>;

  const isModelence =
    (await exists(join(cwd, 'modelence.config.ts'))) ||
    (await exists(join(cwd, 'modelence.config.js')));

  let packageManager: PackageManager = 'npm';
  if (await exists(join(cwd, 'pnpm-lock.yaml'))) {
    packageManager = 'pnpm';
  } else if (await exists(join(cwd, 'yarn.lock'))) {
    packageManager = 'yarn';
  }
  let useNpmLockfile = await exists(join(cwd, 'package-lock.json'));
  if (packageManager === 'npm' && !useNpmLockfile) {
    notes.push('No package-lock.json found; dependencies are installed with `npm install`.');
  }
  if (packageManager === 'npm' && useNpmLockfile) {
    const lockfile = await readJson(join(cwd, 'package-lock.json'));
    if (lockfile && !isLockfileInSync(packageJson, lockfile)) {
      useNpmLockfile = false;
      notes.push(
        'package-lock.json is out of date with package.json, so dependencies are installed with `npm install`. ' +
          'Run `npm install` locally and commit the lockfile to get reproducible `npm ci` installs.'
      );
    }
  }

  let pinnedVersion = parsePackageManagerVersion(packageJson.packageManager, packageManager);
  if (packageManager === 'pnpm' && !pinnedVersion) {
    // No explicit pin: the lockfile format still tells which major wrote it.
    const major = pnpmMajorFromLockfile(await fs.readFile(join(cwd, 'pnpm-lock.yaml'), 'utf8'));
    if (major) {
      pinnedVersion = String(major);
    } else {
      notes.push(
        'Could not tell which pnpm version wrote pnpm-lock.yaml; the build installs the latest. ' +
          'Add e.g. "packageManager": "pnpm@10.4.1" to package.json to pin it.'
      );
    }
  }
  const commands = commandsFor(packageManager, useNpmLockfile, pinnedVersion);

  let buildCommand: string | undefined;
  if (scripts.build) {
    buildCommand = commands.run('build');
  } else if (!isModelence) {
    notes.push('No `build` script found; the deploy skips the build step.');
  }

  let startCommand: string | undefined;
  try {
    startCommand = parseProcfileWebCommand(await fs.readFile(join(cwd, 'Procfile'), 'utf8'));
  } catch {
    // No Procfile — fall through to package.json.
  }
  if (!startCommand && scripts.start) {
    startCommand = commands.start;
  }
  if (!startCommand && !isModelence) {
    const workspace = await detectWorkspaceStart(cwd, packageManager, packageJson);
    startCommand = workspace.startCommand;
    if (workspace.note) {
      notes.push(workspace.note);
    }
  }
  const nodeVersion = parseNodeMajor(engines.node);

  // A client-only site (Vite, Lovable, CRA…): something to build, nothing to
  // start. The runtime serves the build output itself.
  const staticOutput =
    !isModelence && !startCommand && buildCommand
      ? await detectStaticOutput(cwd, packageJson)
      : undefined;
  if (staticOutput) {
    notes.push(
      `No start script found; the site is served from ${staticOutput}/ with single-page app fallback.`
    );
    return {
      preset: 'static',
      packageManager,
      nodeVersion,
      installCommand: commands.install,
      buildCommand,
      outputDirectory: staticOutput,
      notes,
    };
  }

  if (!startCommand) {
    notes.push(
      'No `start` script or Procfile found; the container runs `npm start`. Pass --start-command to override.'
    );
  }

  return {
    preset: isModelence ? 'modelence' : 'node',
    packageManager,
    nodeVersion,
    installCommand: commands.install,
    buildCommand,
    startCommand,
    notes,
  };
}

// Output directory of the common static-site toolchains, or undefined when
// the project doesn't look like one.
async function detectStaticOutput(
  cwd: string,
  packageJson: Record<string, unknown>
): Promise<string | undefined> {
  const deps = {
    ...((packageJson.dependencies ?? {}) as Record<string, string>),
    ...((packageJson.devDependencies ?? {}) as Record<string, string>),
  };
  const hasViteConfig =
    (await exists(join(cwd, 'vite.config.ts'))) ||
    (await exists(join(cwd, 'vite.config.js'))) ||
    (await exists(join(cwd, 'vite.config.mts')));
  if (deps.vite || hasViteConfig) {
    return 'dist';
  }
  if (deps['react-scripts']) {
    return 'build';
  }
  if (deps['@angular/cli']) {
    return 'dist';
  }
  if (deps.astro) {
    return 'dist';
  }
  // A root index.html with a build script is the Vite/Parcel convention.
  if (await exists(join(cwd, 'index.html'))) {
    return 'dist';
  }
  return undefined;
}
