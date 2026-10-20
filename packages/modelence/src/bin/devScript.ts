import { spawn } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { constants } from 'os';
import { delimiter, dirname, join } from 'path';
import { resolveAppRoot } from './appRoot';
import { APP_SPEC_FILE_NAME, isManagedResource, type AppSpec } from './appSpec';
import { assertCommandList } from './deploySpec';
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
  Set while the project's dev command runs, so a dev command that starts
  `modelence dev` again (`"dev": "modelence dev"`) fails instead of looping.
*/
const DEV_COMMAND_ENV_NAME = 'MODELENCE_DEV_COMMAND';

type PackageJson = { scripts?: Record<string, string>; packageManager?: string };

export type Invocation = { command: string; args: string[]; shell: boolean };

/*
  What `modelence dev` runs: the service's `dev` commands from
  modelence.config.json, else the package.json `dev` script in its root.
*/
export type DevTarget =
  | { kind: 'commands'; commands: string[]; root: string }
  | { kind: 'script'; root: string };

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
  packageManager: PackageManager,
  platform: NodeJS.Platform = process.platform
): Invocation {
  const separator = packageManager === 'npm' && args.length > 0 ? ['--'] : [];
  return {
    command: packageManager,
    args: ['run', name, ...separator, ...args],
    // npm, pnpm and yarn are .cmd shims on Windows, which only a shell runs.
    shell: platform === 'win32',
  };
}

/*
  Quotes an argument for the shell the commands run in: POSIX sh, or
  cmd.exe on Windows. Plain words are left as they are.
*/
export function quoteShellArg(arg: string, platform: NodeJS.Platform = process.platform): string {
  if (/^[\w@%+=:,./-]+$/.test(arg)) {
    return arg;
  }
  return platform === 'win32' ? `"${arg.replace(/"/g, '""')}"` : `'${arg.replace(/'/g, `'\\''`)}'`;
}

/*
  Runs the config's dev commands in one shell, one after another like build
  and start; one failing stops the rest. Arguments given to `modelence dev`
  go to the last command, the one that keeps running.
*/
export function resolveCommandsInvocation(
  commands: string[],
  args: string[],
  platform: NodeJS.Platform = process.platform
): Invocation {
  const last = [commands[commands.length - 1], ...args.map((arg) => quoteShellArg(arg, platform))];
  return {
    command: [...commands.slice(0, -1), last.join(' ')].join(' && '),
    args: [],
    shell: true,
  };
}

/*
  `modelence dev` runs one service. Its `dev` commands come first, so the
  config stays the one place that says how the app is built, started and
  run; without them the package.json `dev` script in the service's root
  runs, since that is where a Node project keeps it.
*/
export async function resolveDevTarget(spec: AppSpec, cwd: string): Promise<DevTarget> {
  const services = Object.entries(spec.resources ?? {}).flatMap(([name, resource]) =>
    isManagedResource(resource) ? [] : [[name, resource] as const]
  );
  if (services.length > 1) {
    throw new Error(
      `${APP_SPEC_FILE_NAME} has more than one service; \`modelence dev\` runs only one.`
    );
  }
  if (services.length === 0) {
    return { kind: 'script', root: cwd };
  }

  const [name, resource] = services[0];
  const path = `resources.${name}.dev`;
  assertCommandList(resource.dev, path);
  const root = await resolveAppRoot(cwd, resource.root);
  if (!resource.dev) {
    return { kind: 'script', root };
  }
  if (resource.dev.commands.length === 0) {
    throw new Error(`${APP_SPEC_FILE_NAME}: "${path}.commands" must list at least one command.`);
  }
  return { kind: 'commands', commands: resource.dev.commands, root };
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
  { command, args, shell }: Invocation,
  cwd: string,
  env: ProcessEnv,
  notFoundMessage: string
): void {
  const child = spawn(command, args, { cwd, env, stdio: 'inherit', shell });

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

function failWith(message: string): never {
  console.error(message);
  process.exit(1);
}

/*
  `modelence dev` in a modern app (one with a modelence.config.json): runs
  its dev command with the connected Modelence environment's variables
  loaded, so resources like DATABASE_URL reach the app.
*/
export async function runDevCommand(
  spec: AppSpec,
  args: string[],
  cwd: string,
  extraEnv: ProcessEnv = {}
) {
  if (process.env[DEV_COMMAND_ENV_NAME]) {
    failWith(
      'The dev command runs `modelence dev` again. Set "dev" for the service in ' +
        `${APP_SPEC_FILE_NAME} to the command that starts your dev server (e.g. ["next dev"]), ` +
        'and start it with `npx modelence dev`.'
    );
  }
  let target: DevTarget;
  try {
    target = await resolveDevTarget(spec, cwd);
  } catch (error) {
    failWith(error instanceof Error ? error.message : String(error));
  }
  if (target.kind === 'script' && !hasScript(target.root, DEV_SCRIPT)) {
    failWith(
      `No dev command: add "dev": { "commands": [...] } to the service in ${APP_SPEC_FILE_NAME} ` +
        `(e.g. ["next dev"]), or a "${DEV_SCRIPT}" script to ${join(target.root, 'package.json')}.`
    );
  }

  const env = withLocalBinPath(
    { ...(await loadLocalEnv(cwd, process.env)), ...extraEnv, [DEV_COMMAND_ENV_NAME]: '1' },
    target.root
  );
  if (target.kind === 'commands') {
    spawnAndExit(
      resolveCommandsInvocation(target.commands, args),
      target.root,
      env,
      'Could not start a shell to run the dev command.'
    );
    return;
  }
  const packageManager = detectPackageManager(target.root);
  spawnAndExit(
    resolveScriptInvocation(DEV_SCRIPT, args, packageManager),
    target.root,
    env,
    `${packageManager} is not installed (this project's lockfile asks for it).`
  );
}
