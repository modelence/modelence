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

/*
  Scripts started by `modelence run` in this process tree, so a script that
  runs itself (`"dev": "modelence run dev"`) fails instead of looping.
*/
const RUN_STACK_ENV_NAME = 'MODELENCE_RUN_SCRIPTS';

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
  A package.json script runs through the package manager, like `npm run`;
  any other name runs as a command, so `modelence run next dev` works too.
  npm is the only one that needs `--` before arguments meant for the script.
*/
export function resolveInvocation(
  name: string,
  args: string[],
  scripts: Record<string, string>,
  packageManager: PackageManager
): Invocation {
  if (!Object.prototype.hasOwnProperty.call(scripts, name)) {
    return { command: name, args };
  }
  const separator = packageManager === 'npm' && args.length > 0 ? ['--'] : [];
  return { command: packageManager, args: ['run', name, ...separator, ...args] };
}

function withLocalBinPath(env: ProcessEnv, cwd: string): ProcessEnv {
  const binDir = join(cwd, 'node_modules', '.bin');
  return { ...env, PATH: env.PATH ? `${binDir}${delimiter}${env.PATH}` : binDir };
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

/*
  `modelence run <script|command> [args...]`: runs a package.json script (or
  any command) with the connected Modelence environment's variables loaded,
  so resources like DATABASE_URL reach apps that aren't built on Modelence.
*/
export async function run(name: string, args: string[], cwd: string = process.cwd()) {
  const stack = (process.env[RUN_STACK_ENV_NAME] ?? '').split(',').filter(Boolean);
  if (stack.includes(name)) {
    console.error(
      `"${name}" runs \`modelence run ${name}\` again. Point the script at your app's own ` +
        `command (e.g. "next dev") and start it with \`modelence run ${name}\`.`
    );
    process.exit(1);
  }

  const scripts = readPackageJson(cwd)?.scripts ?? {};
  const invocation = resolveInvocation(name, args, scripts, detectPackageManager(cwd));
  const env = await loadLocalEnv(cwd, process.env);
  const notFoundMessage = Object.prototype.hasOwnProperty.call(scripts, name)
    ? `${invocation.command} is not installed (this project's lockfile asks for it).`
    : `No script named "${name}" in package.json, and no command "${name}" found.`;
  spawnAndExit(
    invocation,
    cwd,
    withLocalBinPath({ ...env, [RUN_STACK_ENV_NAME]: [...stack, name].join(',') }, cwd),
    notFoundMessage
  );
}
