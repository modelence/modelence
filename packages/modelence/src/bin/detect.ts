import { promises as fs } from 'fs';
import { join } from 'path';

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

function commandsFor(packageManager: PackageManager, hasLockfile: boolean) {
  switch (packageManager) {
    case 'pnpm':
      return {
        install: 'npm install -g pnpm && pnpm install --frozen-lockfile',
        run: (script: string) => `pnpm run ${script}`,
        start: 'pnpm start',
      };
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
  const hasNpmLockfile = await exists(join(cwd, 'package-lock.json'));
  if (packageManager === 'npm' && !hasNpmLockfile) {
    notes.push('No package-lock.json found; dependencies are installed with `npm install`.');
  }

  const commands = commandsFor(packageManager, hasNpmLockfile);

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
