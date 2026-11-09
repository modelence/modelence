import { execFileSync, spawn, type ChildProcess } from 'child_process';
import { existsSync, promises as fs, readFileSync } from 'fs';
import { connect as netConnect, createServer } from 'net';
import { tmpdir } from 'os';
import { delimiter, dirname, join, normalize } from 'path';
import {
  APP_SPEC_FILE_NAME,
  isManagedResource,
  type ServiceResource,
  type AppSpec,
} from './appSpec';
import { resolveDeployKind } from './deployKind';
import { prepareSpec } from './deploySpec';
import { quoteShellArg } from './devScript';
import { loadLocalEnv, type ProcessEnv } from './localEnv';
import { listSourceFiles } from './source';

/*
  `modelence verify`: a local rehearsal of what Modelence Cloud does with
  modelence.config.json, so a wrong file fails here instead of after an
  upload and a remote build.

  It copies the files `modelence deploy` would upload into a temporary
  directory, runs the build commands there, starts the result through the
  latest @modelence/runtime — the container entrypoint — on a random PORT, and
  checks that the app answers on it. The image itself is not reproduced: the
  local Node.js and tools are used.
*/

export interface VerifyOptions {
  timeout?: string;
  // The command that starts the runtime; tests replace it.
  runtimeCommand?: string[];
}

const RUNTIME_COMMAND = ['npx', '--yes', '@modelence/runtime@latest'];
// Includes the first `npx` download of the runtime.
const DEFAULT_TIMEOUT_SECONDS = 120;
const STOP_GRACE_MS = 5_000;

export async function verify(options: VerifyOptions = {}): Promise<boolean> {
  const timeoutSeconds = Number(options.timeout ?? DEFAULT_TIMEOUT_SECONDS);
  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) {
    throw new Error('--timeout must be a positive number of seconds.');
  }
  if (process.platform === 'win32') {
    throw new Error(
      'modelence verify needs a POSIX shell and process groups; run it on macOS, Linux or WSL.'
    );
  }
  const cwd = process.cwd();
  if ((await resolveDeployKind(cwd, {})).reason === 'modelence-dependency') {
    throw new Error(
      `No ${APP_SPEC_FILE_NAME} found. This Modelence app is deployed as a local build, which ` +
        `verify does not rehearse: run \`modelence build\` to check it, or add a ${APP_SPEC_FILE_NAME} ` +
        'to build it on Modelence Cloud.'
    );
  }
  const spec = await prepareSpec(cwd);
  const services = Object.values(spec.resources ?? {}).filter(
    (resource): resource is ServiceResource => !isManagedResource(resource)
  );
  if (services.length !== 1) {
    throw new Error(
      `${APP_SPEC_FILE_NAME} must describe exactly one service (found ${services.length}).`
    );
  }
  const resource = services[0];

  /*
    Build commands and the runtime run in process groups of their own, so a
    stop reaches everything they start; Ctrl+C or a SIGTERM from an agent is
    forwarded to them, and the temporary copy is still removed.
  */
  const run: Run = { stopChildren: new Set(), interrupted: false };
  const onSignal = () => {
    run.interrupted = true;
    for (const stopChild of run.stopChildren) {
      void stopChild();
    }
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  let tempDir: string | undefined;
  try {
    // SIGKILL cannot run finally, so killing verify itself can leave this
    // copy in the OS temp directory.
    tempDir = await fs.mkdtemp(join(tmpdir(), 'modelence-verify-'));
    const workDir = join(tempDir, 'app');
    await copySource(cwd, workDir);
    const root = resource.root ?? '.';
    const appRoot = join(workDir, root);
    if (!existsSync(appRoot)) {
      return fail(
        `"root" is "${root}", but none of the uploaded files are in it, so the cloud build would have nothing to run in.`
      );
    }
    if (run.interrupted) {
      return fail('Interrupted.');
    }
    const env = await loadLocalEnv(cwd, process.env, join(cwd, root), { isolated: true });
    return await rehearse(
      resource,
      spec.env ?? {},
      env,
      appRoot,
      join(tempDir, 'app.pgid'),
      timeoutSeconds,
      options,
      run
    );
  } finally {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }
}

interface Run {
  stopChildren: Set<() => Promise<void>>;
  interrupted: boolean;
}

async function rehearse(
  resource: ServiceResource,
  envDeclarations: NonNullable<AppSpec['env']>,
  env: ProcessEnv,
  appRoot: string,
  appGroupFile: string,
  timeoutSeconds: number,
  options: VerifyOptions,
  run: Run
): Promise<boolean> {
  const baseEnv = localEnv(env);

  const buildEnv = sanitizePath({ ...baseEnv, ...declaredValues(envDeclarations, 'build', env) });
  for (const command of resource.build?.commands ?? ['npm install']) {
    console.log(`\n$ ${command}`);
    // Checked right before every spawn: a signal between phases has no child
    // to reach, so the next one must not start.
    if (run.interrupted) {
      return fail('Interrupted.');
    }
    const result = await runToCompletion(command, appRoot, buildEnv, run);
    if (run.interrupted) {
      return fail('Interrupted.');
    }
    if (result !== 0) {
      return fail(
        typeof result === 'string'
          ? `Build command "${command}" was killed by ${result}.`
          : `Build command "${command}" exited with code ${result}.`
      );
    }
  }

  const port = await freePort();
  let appPort = await freePort();
  while (appPort === port) {
    appPort = await freePort();
  }
  const start = resource.start?.commands ?? [];
  // The runtime puts this shell in its own group. Record its PGID before
  // running any commands so we can still find the group if the shell exits.
  const startCommand =
    start.length > 0
      ? `printf '%s\\n' "$$" > ${quoteShellArg(appGroupFile)}\n${start.join(' && ')}`
      : null;
  const [command, ...args] = options.runtimeCommand ?? RUNTIME_COMMAND;
  console.log(`\nStarting through @modelence/runtime on PORT=${port}`);
  if (run.interrupted) {
    return fail('Interrupted.');
  }
  const app = spawn(command, args, {
    cwd: appRoot,
    env: sanitizePath({
      ...baseEnv,
      ...localDatabase(env),
      ...declaredValues(envDeclarations, 'runtime', env),
      PORT: String(port),
      MODELENCE_APP_PORT: String(appPort),
      // Longer than ours, so verify's own message explains a timeout.
      MODELENCE_APP_START_TIMEOUT: String(timeoutSeconds + 30),
      // Studio runs the start commands in order as one shell line.
      MODELENCE_WEB: JSON.stringify({
        start: startCommand,
        static: resource.static ?? [],
      }),
      SITE_URL: `http://localhost:${port}`,
      ROOT_URL: `http://localhost:${port}`,
    }),
    // No stdin, as in the cloud: a process group in the background that
    // reads the terminal would be stopped and never finish.
    stdio: ['ignore', 'inherit', 'inherit'],
    detached: true,
  });
  let spawnError: Error | null = null;
  const exited = new Promise<void>((resolve) => {
    app.once('exit', () => resolve());
    app.once('error', (error) => {
      spawnError = error;
      resolve();
    });
  });
  const stopApp = trackStop(run, app, exited, startCommand ? appGroupFile : undefined);

  let status: number | null;
  try {
    let hasExited = false;
    const opened = await Promise.race([
      waitForPort(port, timeoutSeconds * 1000, () => hasExited),
      exited.then(() => {
        hasExited = true;
        return false;
      }),
    ]);
    if (run.interrupted) {
      return fail('Interrupted.');
    }
    if (spawnError) {
      return fail(`Could not start "${command}": ${(spawnError as Error).message}`);
    }
    if (!opened) {
      if (app.exitCode !== null || app.signalCode !== null) {
        return fail(`The app exited (${app.exitCode ?? app.signalCode}) before answering on PORT.`);
      }
      return fail(
        `Nothing answered on 127.0.0.1:${port} within ${timeoutSeconds}s. The server must listen on ` +
          'process.env.PORT on all interfaces; a hard-coded port or a single address never receives traffic in the cloud.'
      );
    }

    status = await getStatus(port);
  } finally {
    await stopApp();
    run.stopChildren.delete(stopApp);
  }
  if (run.interrupted) {
    return fail('Interrupted.');
  }
  if (status === null || status >= 500) {
    return fail(`GET / answered ${status ?? 'nothing'}. Check the output above.`);
  }
  console.log(`GET / -> ${status}`);
  console.log(
    `\n✓ ${APP_SPEC_FILE_NAME} verified: the app builds and answers on PORT through the Modelence runtime.`
  );
  return true;
}

// Declared values for one phase: committed literals win over the shell or
// connected environment. Managed-resource outputs reach the runtime only.
function declaredValues(
  declarations: NonNullable<AppSpec['env']>,
  scope: 'build' | 'runtime',
  env: ProcessEnv
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [name, declaration] of Object.entries(declarations)) {
    if (!declaration || name === 'PORT' || name.startsWith('MODELENCE_')) {
      continue;
    }
    const scopes =
      declaration.type === 'resource' ? ['runtime'] : (declaration.scopes ?? ['runtime']);
    const value = declaration.type === 'resource' ? env[name] : (declaration.value ?? env[name]);
    if (value !== undefined && scopes.includes(scope)) {
      values[name] = value;
    }
  }
  return values;
}

// Copies the upload's file list into `dir`.
async function copySource(cwd: string, dir: string): Promise<void> {
  const listing = await listSourceFiles(cwd);
  for (const file of listing.files) {
    await fs.mkdir(dirname(join(dir, file)), { recursive: true });
    await fs.copyFile(join(cwd, file), join(dir, file));
  }
  for (const link of listing.symlinks) {
    await fs.mkdir(dirname(join(dir, link.path)), { recursive: true });
    await fs.symlink(link.target, join(dir, link.path));
  }
  console.log(
    `Copied the ${listing.files.length + listing.symlinks.length} files \`modelence deploy\` uploads to ${dir}`
  );
}

/*
  Only what the build and the app need to run on this machine, not the
  developer's whole shell: a variable the app reads without declaring it in
  "env" must fail here as it would in the cloud. A service token in the
  shell would also make the runtime fetch a real environment's variables.
*/
const PASSTHROUGH_ENV = [
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'TMPDIR',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TERM',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'no_proxy',
];

function localEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(
    PASSTHROUGH_ENV.filter((name) => env[name]).map((name) => [name, env[name]])
  );
}

function sanitizePath(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  // npm scripts and npx add the original project's tools to PATH. They must
  // not mask missing dependencies in the isolated copy, including when PATH
  // is declared in the spec. Clean it after all phase values are merged.
  if (env.PATH === undefined) {
    return env;
  }
  return {
    ...env,
    PATH: env.PATH.split(delimiter)
      .filter((entry) => !/(^|\/)node_modules\/\.bin\/?$/.test(normalize(entry)))
      .join(delimiter),
  };
}

// The cloud provisions a database; a local one from the shell stands in for it.
function localDatabase(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const uri = env.MONGODB_URI ?? env.MONGO_URL;
  return uri ? { MONGODB_URI: uri, MONGO_URL: uri } : {};
}

async function runToCompletion(
  command: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  run: Run
): Promise<number | NodeJS.Signals> {
  const child = spawn('sh', ['-c', command], {
    cwd,
    env,
    stdio: ['ignore', 'inherit', 'inherit'],
    detached: true,
  });
  const exited = new Promise<number | NodeJS.Signals>((resolve) => {
    child.once('exit', (code, signal) => resolve(code ?? signal ?? 1));
    child.once('error', () => resolve(127));
  });
  const stopChild = trackStop(run, child, exited);
  try {
    return await exited;
  } finally {
    await stopChild();
    run.stopChildren.delete(stopChild);
  }
}

function trackStop(run: Run, child: ChildProcess, exited: Promise<unknown>, appGroupFile?: string) {
  // The interrupt handler and finally must share the same group snapshot.
  let stopping: Promise<void> | undefined;
  const stopChild = () => (stopping ??= stop(child, exited, appGroupFile));
  run.stopChildren.add(stopChild);
  return stopChild;
}

async function stop(
  child: ChildProcess,
  exited: Promise<unknown>,
  appGroupFile?: string
): Promise<void> {
  if (!child.pid || (!appGroupFile && !signalGroup(child.pid, 0))) {
    return;
  }
  // Capture detached groups before SIGTERM can orphan them. The runtime
  // may exit with the shell while the app is still draining or ignoring TERM.
  const table = readProcessTable();
  const groups = new Set(processGroupsBelow(child.pid, table));
  if (appGroupFile) {
    const appGroup = readAppGroup(appGroupFile);
    const ownGroup = table.find((row) => row.pid === process.pid)?.pgid;
    if (appGroup !== undefined && appGroup !== ownGroup && !groups.has(appGroup)) {
      groups.add(appGroup);
      signalGroup(appGroup, 'SIGTERM');
    }
  }
  signalGroup(child.pid, 'SIGTERM');
  const timer = setTimeout(() => {
    for (const group of groups) {
      signalGroup(group, 'SIGKILL');
    }
    groups.clear();
  }, STOP_GRACE_MS);
  try {
    await exited;
    while (groups.size > 0) {
      for (const group of groups) {
        if (!signalGroup(group, 0)) {
          groups.delete(group);
        }
      }
      if (groups.size > 0) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
  } finally {
    clearTimeout(timer);
  }
}

function readAppGroup(file: string): number | undefined {
  try {
    const group = Number(readFileSync(file, 'utf8'));
    return Number.isSafeInteger(group) && group > 1 && group <= 0x7fffffff ? group : undefined;
  } catch {
    // The runtime can exit before it launches the start shell.
    return undefined;
  }
}

function signalGroup(group: number, signal: NodeJS.Signals | 0): boolean {
  try {
    process.kill(-group, signal);
    return true;
  } catch {
    return false;
  }
}

export function processGroupsBelow(pid: number, table = readProcessTable()): number[] {
  const own = table.find((row) => row.pid === process.pid)?.pgid;
  const groups = new Set<number>([pid]);
  const pending = [pid];
  while (pending.length > 0) {
    const parent = pending.pop();
    for (const row of table) {
      if (row.ppid === parent) {
        pending.push(row.pid);
        groups.add(row.pgid);
      }
    }
  }
  return [...groups].filter((group) => group > 1 && group !== own);
}

interface ProcessRow {
  pid: number;
  ppid: number;
  pgid: number;
}

// An empty table leaves only the child's own group to signal.
function readProcessTable(): ProcessRow[] {
  try {
    return execFileSync('ps', ['-A', '-o', 'pid=,ppid=,pgid='], { encoding: 'utf8' })
      .split('\n')
      .map((line) => line.trim().split(/\s+/).map(Number))
      .filter((fields) => fields.length === 3 && fields.every(Number.isInteger))
      .map(([pid, ppid, pgid]) => ({ pid, ppid, pgid }));
  } catch {
    return [];
  }
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

function canConnect(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = netConnect(port, '127.0.0.1');
    const finish = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.setTimeout(1000, () => finish(false));
  });
}

async function waitForPort(
  port: number,
  timeoutMs: number,
  gaveUp: () => boolean
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (!(await canConnect(port))) {
    if (gaveUp() || Date.now() >= deadline) {
      return false;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return true;
}

async function getStatus(port: number): Promise<number | null> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/`, {
      headers: { Accept: 'text/html' },
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
    });
    await response.body?.cancel();
    return response.status;
  } catch {
    return null;
  }
}

function fail(reason: string): false {
  console.log(`\n✗ Verification failed.\n${reason}`);
  return false;
}
