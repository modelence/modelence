import { spawn, type ChildProcess } from 'child_process';
import { existsSync, promises as fs } from 'fs';
import { connect as netConnect, createServer } from 'net';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { APP_SPEC_FILE_NAME, type AppResource, type AppSpec } from './appSpec';
import { resolveDeployKind } from './deployKind';
import { prepareSpec } from './deploySpec';
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
  const resources = Object.values(spec.resources ?? {});
  if (resources.length !== 1) {
    throw new Error(
      `${APP_SPEC_FILE_NAME} must describe exactly one resource (found ${resources.length}).`
    );
  }
  const resource = resources[0];

  /*
    Build commands and the runtime run in process groups of their own, so a
    stop reaches everything they start; Ctrl+C or a SIGTERM from an agent is
    forwarded to them, and the temporary copy is still removed.
  */
  const run: Run = { children: new Set(), interrupted: false };
  const onSignal = () => {
    run.interrupted = true;
    for (const child of run.children) {
      signalGroup(child, 'SIGTERM');
    }
    // Whatever ignores the stop request is killed, so a cancel always ends.
    setTimeout(() => {
      for (const child of run.children) {
        signalGroup(child, 'SIGKILL');
      }
    }, STOP_GRACE_MS).unref();
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  let tempDir: string | undefined;
  try {
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
    return await rehearse(resource, spec.env ?? {}, appRoot, timeoutSeconds, options, run);
  } finally {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }
}

interface Run {
  children: Set<ChildProcess>;
  interrupted: boolean;
}

async function rehearse(
  resource: AppResource,
  envDeclarations: NonNullable<AppSpec['env']>,
  appRoot: string,
  timeoutSeconds: number,
  options: VerifyOptions,
  run: Run
): Promise<boolean> {
  const baseEnv = localEnv(process.env);

  const buildEnv = { ...baseEnv, ...committedValues(envDeclarations, 'build') };
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
  const [command, ...args] = options.runtimeCommand ?? RUNTIME_COMMAND;
  console.log(`\nStarting through @modelence/runtime on PORT=${port}`);
  if (run.interrupted) {
    return fail('Interrupted.');
  }
  const app = spawn(command, args, {
    cwd: appRoot,
    env: {
      ...baseEnv,
      ...localDatabase(process.env),
      ...committedValues(envDeclarations, 'runtime'),
      PORT: String(port),
      MODELENCE_APP_PORT: String(appPort),
      // Longer than ours, so verify's own message explains a timeout.
      MODELENCE_APP_START_TIMEOUT: String(timeoutSeconds + 30),
      // Studio runs the start commands in order as one shell line.
      MODELENCE_WEB: JSON.stringify({
        start: start.length > 0 ? start.join(' && ') : null,
        static: resource.static ?? [],
      }),
      SITE_URL: `http://localhost:${port}`,
      ROOT_URL: `http://localhost:${port}`,
    },
    // No stdin, as in the cloud: a process group in the background that
    // reads the terminal would be stopped and never finish.
    stdio: ['ignore', 'inherit', 'inherit'],
    detached: true,
  });
  run.children.add(app);
  let spawnError: Error | null = null;
  const exited = new Promise<void>((resolve) => {
    app.once('exit', () => resolve());
    app.once('error', (error) => {
      spawnError = error;
      resolve();
    });
  });

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

    const status = await getStatus(port);
    if (status === null || status >= 500) {
      return fail(`GET / answered ${status ?? 'nothing'}. Check the output above.`);
    }
    console.log(`GET / -> ${status}`);
    console.log(
      `\n✓ ${APP_SPEC_FILE_NAME} verified: the app builds and answers on PORT through the Modelence runtime.`
    );
    return true;
  } finally {
    await stop(app, exited);
    run.children.delete(app);
  }
}

// Values committed in the file for one phase; a declaration without scopes
// reaches the runtime only. Dashboard values are not available here.
function committedValues(
  declarations: NonNullable<AppSpec['env']>,
  scope: 'build' | 'runtime'
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [name, declaration] of Object.entries(declarations)) {
    if (declaration?.value !== undefined && (declaration.scopes ?? ['runtime']).includes(scope)) {
      values[name] = declaration.value;
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

// The cloud provisions a database; a local one from the shell stands in for it.
function localDatabase(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const uri = env.MONGODB_URI ?? env.MONGO_URL;
  return uri ? { MONGODB_URI: uri, MONGO_URL: uri } : {};
}

function runToCompletion(
  command: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  run: Run
): Promise<number | NodeJS.Signals> {
  // The exit code, or the signal that killed the command.
  return new Promise((resolve) => {
    const child = spawn('sh', ['-c', command], {
      cwd,
      env,
      stdio: ['ignore', 'inherit', 'inherit'],
      detached: true,
    });
    run.children.add(child);
    const done = (result: number | NodeJS.Signals) => {
      run.children.delete(child);
      resolve(result);
    };
    child.once('exit', (code, signal) => done(code ?? signal ?? 1));
    child.once('error', () => done(127));
  });
}

async function stop(child: ChildProcess, exited: Promise<void>): Promise<void> {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  signalGroup(child, 'SIGTERM');
  const timer = setTimeout(() => signalGroup(child, 'SIGKILL'), STOP_GRACE_MS);
  await exited;
  clearTimeout(timer);
}

function signalGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  // Without a pid the spawn failed; -0 would be this process's own group.
  if (!child.pid) {
    return;
  }
  try {
    process.kill(-child.pid, signal);
  } catch {
    // Already gone.
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
