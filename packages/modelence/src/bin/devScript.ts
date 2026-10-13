import { spawn } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { constants } from 'os';
import { delimiter, dirname, join } from 'path';
import { loadLocalEnv, type ProcessEnv } from './localEnv';

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

const PACKAGE_MANAGERS: PackageManager[] = ['npm', 'pnpm', 'yarn', 'bun'];

const LOCKFILES: [string, PackageManager][] = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
  ['package-lock.json', 'npm'],
];

export const DEV_SCRIPT = 'dev';

/*
  Set while the project's dev script runs, so a script that starts
  `modelence dev` again (`"dev": "modelence dev"`) fails instead of looping.
*/
const DEV_SCRIPT_ENV_NAME = 'MODELENCE_DEV_SCRIPT';

type PackageJson = { scripts?: Record<string, string>; packageManager?: string };

export type Invocation = { command: string; args: string[] };

function readPackageJson(dir: string): PackageJson | null {
  try {
    return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8')) as PackageJson;
  } catch {
    return null;
  }
}

function parsePackageManagerField(value: string | undefined): PackageManager | null {
  const name = value?.split('@')[0];
  return PACKAGE_MANAGERS.find((manager) => manager === name) ?? null;
}

/*
  The package manager the project uses: package.json's `packageManager`
  field, else the nearest lockfile walking up (a workspace keeps it at the
  root), else npm.
*/
export function detectPackageManager(cwd: string): PackageManager {
  const declared = parsePackageManagerField(readPackageJson(cwd)?.packageManager);
  if (declared) {
    return declared;
  }
  for (let dir = cwd; ; dir = dirname(dir)) {
    const match = LOCKFILES.find(([file]) => existsSync(join(dir, file)));
    if (match) {
      return match[1];
    }
    if (dirname(dir) === dir) {
      return 'npm';
    }
  }
}

/*
  Runs a package.json script through the package manager, like `npm run`.
  npm is the only one that needs `--` before arguments meant for the script.
*/
export function resolveScriptInvocation(
  name: string,
  args: string[],
  packageManager: PackageManager
): Invocation {
  const separator = packageManager === 'npm' && args.length > 0 ? ['--'] : [];
  return { command: packageManager, args: ['run', name, ...separator, ...args] };
}

/*
  Windows names the variable `Path`, and a copy of process.env is no longer
  case-insensitive, so prepend to whichever key holds it rather than adding a
  second `PATH` that would hide the system one.
*/
export function withLocalBinPath(env: ProcessEnv, cwd: string): ProcessEnv {
  const binDir = join(cwd, 'node_modules', '.bin');
  const key = Object.keys(env).find((name) => name.toUpperCase() === 'PATH') ?? 'PATH';
  const current = env[key];
  return { ...env, [key]: current ? `${binDir}${delimiter}${current}` : binDir };
}

function exitCodeOf(code: number | null, signal: NodeJS.Signals | null): number {
  if (code !== null) {
    return code;
  }
  // The shell convention for a process killed by a signal.
  return signal ? 128 + (constants.signals[signal] ?? 0) : 1;
}

function spawnAndExit(
  { command, args }: Invocation,
  cwd: string,
  env: ProcessEnv,
  notFoundMessage: string
): void {
  const child = spawn(command, args, {
    cwd,
    env,
    stdio: 'inherit',
    // npm, pnpm and yarn are .cmd shims on Windows, which only a shell runs.
    shell: process.platform === 'win32',
  });

  // Ctrl+C reaches the whole process group; wait for the child to exit
  // rather than dying first and leaving it orphaned.
  process.on('SIGINT', () => {});
  process.on('SIGTERM', () => child.kill('SIGTERM'));
  process.on('SIGHUP', () => child.kill('SIGHUP'));

  child.on('error', (error: NodeJS.ErrnoException) => {
    console.error(
      error.code === 'ENOENT' ? notFoundMessage : `Failed to start "${command}": ${error.message}`
    );
    process.exit(1);
  });
  child.on('exit', (code, signal) => process.exit(exitCodeOf(code, signal)));
}

function hasScript(cwd: string, name: string): boolean {
  const scripts = readPackageJson(cwd)?.scripts ?? {};
  return Object.prototype.hasOwnProperty.call(scripts, name);
}

/*
  `modelence dev` outside a Modelence framework app: runs the project's own
  package.json `dev` script with the connected Modelence environment's
  variables loaded, so resources like DATABASE_URL reach any Node.js app.
*/
export async function runDevScript(args: string[], cwd: string = process.cwd()) {
  if (process.env[DEV_SCRIPT_ENV_NAME]) {
    console.error(
      `The "${DEV_SCRIPT}" script in package.json runs \`modelence dev\` again. Set it to ` +
        `your app's own dev command (e.g. "next dev") and start it with \`npx modelence dev\`.`
    );
    process.exit(1);
  }
  if (!hasScript(cwd, DEV_SCRIPT)) {
    console.error(
      `No "${DEV_SCRIPT}" script in package.json. Add one that starts your app's dev server ` +
        '(e.g. "next dev"), or a modelence.config.ts for a Modelence framework app.'
    );
    process.exit(1);
  }

  const packageManager = detectPackageManager(cwd);
  const env = await loadLocalEnv(cwd, process.env);
  spawnAndExit(
    resolveScriptInvocation(DEV_SCRIPT, args, packageManager),
    cwd,
    withLocalBinPath({ ...env, [DEV_SCRIPT_ENV_NAME]: '1' }, cwd),
    `${packageManager} is not installed (this project's lockfile asks for it).`
  );
}
