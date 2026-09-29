import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verify } from './verify';

/*
  The copy, the build commands and the child processes are real. The runtime
  is a stand-in that runs MODELENCE_WEB.start the way @modelence/runtime does
  for a start-only app and records what it was given, so the tests need no
  network for `npx`.
*/

let dir: string;
let runtimeDir: string;
let logged: string[];

const fakeRuntime = (record: string) => `
const { spawn } = require('child_process');
require('fs').writeFileSync(${JSON.stringify(record)}, JSON.stringify(process.env));
const web = JSON.parse(process.env.MODELENCE_WEB);
const app = spawn('sh', ['-c', web.start], { stdio: 'inherit', env: process.env });
app.on('exit', (code) => process.exit(code ?? 1));
process.on('SIGTERM', () => app.kill('SIGTERM'));
`;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'modelence-verify-test-'));
  runtimeDir = await mkdtemp(join(tmpdir(), 'modelence-verify-runtime-'));
  await writeFile(join(runtimeDir, 'runtime.cjs'), fakeRuntime(join(runtimeDir, 'env.json')));
  logged = [];
  vi.spyOn(process, 'cwd').mockReturnValue(dir);
  vi.spyOn(console, 'log').mockImplementation((line: string) => {
    logged.push(String(line));
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
  await rm(runtimeDir, { recursive: true, force: true });
});

async function project(files: Record<string, string>, resource: object, env?: object) {
  for (const [path, content] of Object.entries(files)) {
    await writeFile(join(dir, path), content);
  }
  await writeFile(
    join(dir, 'modelence.config.json'),
    JSON.stringify({ resources: { app: { type: 'service', ...resource } }, env })
  );
}

function run(timeout = '10') {
  return verify({ timeout, runtimeCommand: [process.execPath, join(runtimeDir, 'runtime.cjs')] });
}

const server = (port: string) =>
  `require('http').createServer((q, s) => s.end('ok')).listen(${port});`;

function output() {
  return logged.join('\n');
}

describe('verify', () => {
  it('passes an app that builds and listens on PORT', async () => {
    await project(
      { 'server.js': server('Number(process.env.PORT)') },
      { build: { commands: ['echo built > built.txt'] }, start: { commands: ['node server.js'] } }
    );
    expect(await run()).toBe(true);
    expect(output()).toContain('GET / -> 200');
    expect(output()).toContain('modelence.config.json verified');
  }, 20_000);

  it('gives the runtime the spec, a random PORT and the committed env values', async () => {
    vi.stubEnv('MODELENCE_SERVICE_TOKEN', 'from-shell');
    await project(
      { 'server.js': server('Number(process.env.PORT)') },
      { build: { commands: [] }, start: { commands: ['test -f server.js', 'node server.js'] } },
      { API_URL: { value: '/api' }, SECRET: { type: 'secret' } }
    );
    expect(await run()).toBe(true);
    const env = JSON.parse(await readFile(join(runtimeDir, 'env.json'), 'utf8'));
    expect(JSON.parse(env.MODELENCE_WEB)).toEqual({
      start: 'test -f server.js && node server.js',
      static: [],
    });
    expect(env.PORT).not.toBe('3000');
    expect(env.SITE_URL).toBe(`http://localhost:${env.PORT}`);
    expect(env.API_URL).toBe('/api');
    expect(env.SECRET).toBeUndefined();
    expect(env.MODELENCE_SERVICE_TOKEN).toBeUndefined();
  }, 20_000);

  it('gives each phase only the committed values scoped to it', async () => {
    const record = join(runtimeDir, 'build.txt');
    await project(
      { 'server.js': server('Number(process.env.PORT)') },
      {
        build: { commands: [`echo "$BUILD_ONLY|$RUNTIME_ONLY|$BOTH" > ${record}`] },
        start: { commands: ['node server.js'] },
      },
      {
        BUILD_ONLY: { value: 'b', scopes: ['build'] },
        RUNTIME_ONLY: { value: 'r' },
        BOTH: { value: 'x', scopes: ['build', 'runtime'] },
      }
    );
    expect(await run()).toBe(true);
    expect((await readFile(record, 'utf8')).trim()).toBe('b||x');
    const env = JSON.parse(await readFile(join(runtimeDir, 'env.json'), 'utf8'));
    expect([env.BUILD_ONLY, env.RUNTIME_ONLY, env.BOTH]).toEqual([undefined, 'r', 'x']);
  }, 20_000);

  it('reports a runtime that cannot be started, without signalling its own process group', async () => {
    await project(
      { 'server.js': server('Number(process.env.PORT)') },
      { build: { commands: [] }, start: { commands: ['node server.js'] } }
    );
    const passed = await verify({
      timeout: '5',
      runtimeCommand: [join(runtimeDir, 'does-not-exist')],
    });
    // Signalling group 0 would have taken this test process down with it.
    expect(passed).toBe(false);
    expect(output()).toMatch(/Could not start ".*does-not-exist": spawn .* ENOENT/);
  }, 20_000);

  it('stops the runtime and the app when interrupted', async () => {
    const pidFile = join(runtimeDir, 'app.pid');
    await project(
      {
        'server.js': `require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));\n${server('0')}`,
      },
      { build: { commands: [] }, start: { commands: ['node server.js'] } }
    );
    setTimeout(() => process.emit('SIGTERM'), 1500);
    expect(await run('10')).toBe(false);
    expect(output()).toContain('Interrupted.');
    const pid = Number(await readFile(pidFile, 'utf8'));
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(() => process.kill(pid, 0)).toThrow();
  }, 20_000);

  it('starts nothing new once interrupted between phases', async () => {
    const marker = join(runtimeDir, 'built');
    await project(
      { 'server.js': server('Number(process.env.PORT)') },
      { build: { commands: [`touch ${marker}`] }, start: { commands: ['node server.js'] } }
    );
    // The signal lands after the command is announced and before it is spawned.
    vi.mocked(console.log).mockImplementation((line: string) => {
      logged.push(String(line));
      if (String(line).includes(`$ touch ${marker}`)) {
        process.emit('SIGTERM');
      }
    });
    expect(await run()).toBe(false);
    expect(output()).toContain('Interrupted.');
    await expect(readFile(marker)).rejects.toThrow();

    // The same between the build and the runtime.
    await project(
      { 'server.js': server('Number(process.env.PORT)') },
      { build: { commands: [] }, start: { commands: ['node server.js'] } }
    );
    logged = [];
    vi.mocked(console.log).mockImplementation((line: string) => {
      logged.push(String(line));
      if (String(line).includes('Starting through @modelence/runtime')) {
        process.emit('SIGTERM');
      }
    });
    expect(await run()).toBe(false);
    expect(output()).toContain('Interrupted.');
    await expect(readFile(join(runtimeDir, 'env.json'))).rejects.toThrow();
  }, 20_000);

  it('fails an app that ignores PORT', async () => {
    await project(
      { 'server.js': server('0') },
      { build: { commands: [] }, start: { commands: ['node server.js'] } }
    );
    expect(await run('2')).toBe(false);
    expect(output()).toMatch(/Nothing answered on 127\.0\.0\.1:\d+ within 2s/);
  }, 20_000);

  it('builds only the uploaded files, without local .env files', async () => {
    await project(
      {
        '.env': 'API_KEY=local',
        'server.js':
          "if (!require('fs').existsSync('.env')) process.exit(3);\n" +
          server('Number(process.env.PORT)'),
      },
      { build: { commands: [] }, start: { commands: ['node server.js'] } }
    );
    expect(await run()).toBe(false);
    expect(output()).toContain('The app exited (3) before answering on PORT.');
  }, 20_000);

  it('stops at the first failing build command', async () => {
    await project(
      {},
      { build: { commands: ['exit 7', 'touch never'] }, start: { commands: ['node .'] } }
    );
    expect(await run()).toBe(false);
    expect(output()).toContain('Build command "exit 7" exited with code 7.');
    expect(output()).not.toContain('$ touch never');
  });

  it('cleans up when the copy fails', async () => {
    await project(
      { 'secret.txt': 'x' },
      { build: { commands: [] }, start: { commands: ['node .'] } }
    );
    await chmod(join(dir, 'secret.txt'), 0o000);
    const tempDirs = async () =>
      (await readdir(tmpdir())).filter(
        (name) =>
          name.startsWith('modelence-verify-') &&
          !name.includes('test') &&
          !name.includes('runtime')
      );
    const before = await tempDirs();
    const listeners = process.listenerCount('SIGTERM');
    await expect(run()).rejects.toThrow(/EACCES/);
    expect(await tempDirs()).toEqual(before);
    expect(process.listenerCount('SIGTERM')).toBe(listeners);
    await chmod(join(dir, 'secret.txt'), 0o600);
  });

  it('kills what ignores the stop request after an interrupt', async () => {
    const pidFile = join(runtimeDir, 'app.pid');
    await project(
      {
        'server.js':
          `process.on('SIGTERM', () => {});\n` +
          `require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));\n` +
          server('0'),
      },
      { build: { commands: [] }, start: { commands: ['node server.js'] } }
    );
    setTimeout(() => process.emit('SIGTERM'), 1000);
    const started = Date.now();
    expect(await run('60')).toBe(false);
    // The grace period, not the 60s start timeout.
    expect(Date.now() - started).toBeLessThan(12_000);
    expect(output()).toContain('Interrupted.');
    const pid = Number(await readFile(pidFile, 'utf8'));
    expect(() => process.kill(pid, 0)).toThrow();
  }, 20_000);

  it('gives build commands no stdin, as in the cloud', async () => {
    await project(
      { 'server.js': server('Number(process.env.PORT)') },
      { build: { commands: ['cat > /dev/null'] }, start: { commands: ['node server.js'] } }
    );
    expect(await run()).toBe(true);
  }, 20_000);

  it('fails when root holds none of the uploaded files', async () => {
    await mkdir(join(dir, 'web'));
    await project(
      { 'web/.env': 'LOCAL=1' },
      { root: 'web', build: { commands: [] }, start: { commands: ['node .'] } }
    );
    expect(await run()).toBe(false);
    expect(output()).toContain('"root" is "web", but none of the uploaded files are in it');
  });

  it('rejects a timeout that is not a positive number', async () => {
    await project({}, { build: { commands: [] }, start: { commands: ['node .'] } });
    await expect(verify({ timeout: '-5' })).rejects.toThrow('--timeout must be a positive number');
    await expect(verify({ timeout: 'soon' })).rejects.toThrow(
      '--timeout must be a positive number'
    );
  });

  it('passes only the local essentials and a local database, not the whole shell', async () => {
    vi.stubEnv('SHELL_ONLY', 'leaked');
    vi.stubEnv('MONGODB_URI', 'mongodb://127.0.0.1:27017/verify');
    const record = join(runtimeDir, 'build.txt');
    await project(
      { 'server.js': server('Number(process.env.PORT)') },
      {
        build: { commands: [`echo "$SHELL_ONLY|$MONGODB_URI|$PATH" > ${record}`] },
        start: { commands: ['node server.js'] },
      }
    );
    expect(await run()).toBe(true);
    const [shellOnly, buildDb, path] = (await readFile(record, 'utf8')).trim().split('|');
    expect([shellOnly, buildDb]).toEqual(['', '']);
    expect(path).toBe(process.env.PATH);
    const env = JSON.parse(await readFile(join(runtimeDir, 'env.json'), 'utf8'));
    expect(env.SHELL_ONLY).toBeUndefined();
    expect([env.MONGODB_URI, env.MONGO_URL]).toEqual([
      'mongodb://127.0.0.1:27017/verify',
      'mongodb://127.0.0.1:27017/verify',
    ]);
  }, 20_000);

  it('names the signal that killed a build command', async () => {
    await project({}, { build: { commands: ['kill -KILL $$'] }, start: { commands: ['node .'] } });
    expect(await run()).toBe(false);
    expect(output()).toContain('Build command "kill -KILL $$" was killed by SIGKILL.');
  });

  it('points a Modelence framework app without a config file to modelence build', async () => {
    await writeFile(
      join(dir, 'package.json'),
      JSON.stringify({ dependencies: { modelence: '^0.26.0' } })
    );
    await expect(run()).rejects.toThrow(
      /This Modelence app is deployed as a local build.*modelence build/
    );
  });

  it('refuses to run on Windows', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    await expect(run()).rejects.toThrow('POSIX shell');
  });

  it('requires exactly one resource', async () => {
    await writeFile(join(dir, 'modelence.config.json'), JSON.stringify({ resources: {} }));
    await expect(run()).rejects.toThrow('exactly one resource (found 0)');
  });
});
