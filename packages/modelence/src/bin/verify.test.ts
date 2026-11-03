import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { processGroupsBelow, verify } from './verify';

/*
  The copy, the build commands and the child processes are real. The runtime
  is a stand-in that runs MODELENCE_WEB.start the way @modelence/runtime does
  for a start-only app, in a process group of its own, and records what it
  was given, so the tests need no network for `npx`.
*/

let dir: string;
let runtimeDir: string;
let logged: string[];

const fakeRuntime = (record: string) => `
const { spawn } = require('child_process');
require('fs').writeFileSync(${JSON.stringify(record)}, JSON.stringify(process.env));
const web = JSON.parse(process.env.MODELENCE_WEB);
// Like @modelence/runtime: the app gets a process group of its own, and a
// stop signal is forwarded to that group.
const app = spawn('sh', ['-c', web.start], { stdio: 'inherit', env: process.env, detached: true });
app.on('exit', (code) => process.exit(code ?? 1));
process.on('SIGTERM', () => {
  try { process.kill(-app.pid, 'SIGTERM'); } catch {}
});
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

async function project(
  files: Record<string, string>,
  resource: object,
  env?: object,
  managedResources: object = {}
) {
  for (const [path, content] of Object.entries(files)) {
    await writeFile(join(dir, path), content);
  }
  await writeFile(
    join(dir, 'modelence.config.json'),
    JSON.stringify({
      resources: { ...managedResources, app: { type: 'service', ...resource } },
      env,
    })
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

  it('accepts one service alongside managed PostgreSQL and Redis resources', async () => {
    await project(
      { 'server.js': server('Number(process.env.PORT)') },
      { build: { commands: [] }, start: { commands: ['node server.js'] } },
      undefined,
      { 'main-db': { type: 'postgres' }, cache: { type: 'redis' } }
    );
    expect(await run()).toBe(true);
  }, 20_000);

  it('passes declared shell values by scope, with committed values taking precedence', async () => {
    vi.stubEnv('NPM_TOKEN', 'install-token');
    vi.stubEnv('STRIPE_SECRET_KEY', 'runtime-secret');
    vi.stubEnv('BOTH', 'shared');
    vi.stubEnv('API_URL', 'shell-url');
    vi.stubEnv('EMPTY', 'shell-value');
    vi.stubEnv('UNDECLARED', 'must-not-pass');
    const record = join(runtimeDir, 'build.txt');
    await project(
      { 'server.js': server('Number(process.env.PORT)') },
      {
        build: {
          commands: [
            `printf '%s' "$NPM_TOKEN|$STRIPE_SECRET_KEY|$BOTH|$API_URL|$EMPTY|$UNDECLARED" > ${record}`,
          ],
        },
        start: { commands: ['node server.js'] },
      },
      {
        NPM_TOKEN: { type: 'secret', scopes: ['build'] },
        STRIPE_SECRET_KEY: { type: 'secret' },
        BOTH: { scopes: ['build', 'runtime'] },
        API_URL: { value: '/api', scopes: ['build', 'runtime'] },
        EMPTY: { value: '', scopes: ['build', 'runtime'] },
      }
    );
    expect(await run()).toBe(true);
    expect(await readFile(record, 'utf8')).toBe('install-token||shared|/api||');
    const env = JSON.parse(await readFile(join(runtimeDir, 'env.json'), 'utf8'));
    expect(env.STRIPE_SECRET_KEY).toBe('runtime-secret');
    expect(env.BOTH).toBe('shared');
    expect(env.API_URL).toBe('/api');
    expect(env.EMPTY).toBe('');
    expect(env.NPM_TOKEN).toBeUndefined();
    expect(env.UNDECLARED).toBeUndefined();
  }, 20_000);

  it('loads connected env values despite local env files excluded from the rehearsal', async () => {
    vi.stubEnv('NODE_ENV', undefined);
    const appRoot = join(dir, 'web');
    await mkdir(appRoot);
    await writeFile(
      join(dir, '.modelence.env'),
      'MODELENCE_SERVICE_ENDPOINT=https://cloud.example.com\nMODELENCE_SERVICE_TOKEN=test-token\n'
    );
    const realFetch = globalThis.fetch;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      if (input === 'https://cloud.example.com/api/env') {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              env: {
                DATABASE_URL: 'postgres://remote',
                REDIS_URL: 'redis://remote',
                NPM_TOKEN: 'remote-install-token',
                STRIPE_SECRET_KEY: 'remote-secret',
                API_URL: 'remote-url',
                NODE_ENV: 'production',
                SITE_URL: 'https://app.cloud',
                UNDECLARED: 'must-not-pass',
              },
            })
          )
        );
      }
      return realFetch(input, init);
    });
    const record = join(runtimeDir, 'build.txt');
    await project(
      {
        '.env.local': 'NPM_TOKEN=local-token\n',
        'web/.env': 'DATABASE_URL=postgres://local\nSTRIPE_SECRET_KEY=local-secret\n',
        'web/server.js':
          'if (!process.env.STRIPE_SECRET_KEY || !process.env.DATABASE_URL) process.exit(3);\n' +
          server('Number(process.env.PORT)'),
      },
      {
        root: 'web',
        build: {
          commands: [`printf '%s' "$NPM_TOKEN|$DATABASE_URL|$NODE_ENV|$SITE_URL" > ${record}`],
        },
        start: { commands: ['node server.js'] },
      },
      {
        DATABASE_URL: { type: 'resource', resource: 'main-db', output: 'url' },
        REDIS_URL: { type: 'resource', resource: 'cache', output: 'url' },
        NPM_TOKEN: { type: 'secret', scopes: ['build'] },
        STRIPE_SECRET_KEY: { type: 'secret' },
        API_URL: { value: '/api' },
        NODE_ENV: { scopes: ['build', 'runtime'] },
        SITE_URL: { scopes: ['build'] },
      },
      { 'main-db': { type: 'postgres' }, cache: { type: 'redis' } }
    );
    expect(await run()).toBe(true);
    expect(await readFile(record, 'utf8')).toBe(
      'remote-install-token||production|https://app.cloud'
    );
    const env = JSON.parse(await readFile(join(runtimeDir, 'env.json'), 'utf8'));
    expect(env.DATABASE_URL).toBe('postgres://remote');
    expect(env.REDIS_URL).toBe('redis://remote');
    expect(env.STRIPE_SECRET_KEY).toBe('remote-secret');
    expect(env.API_URL).toBe('/api');
    expect(env.NODE_ENV).toBe('production');
    expect(env.SITE_URL).toBe(`http://localhost:${env.PORT}`);
    expect(env.NPM_TOKEN).toBeUndefined();
    expect(env.UNDECLARED).toBeUndefined();
    expect(env.MODELENCE_SERVICE_TOKEN).toBeUndefined();
    expect(env.MODELENCE_SERVICE_ENDPOINT).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      'https://cloud.example.com/api/env',
      expect.objectContaining({ headers: { Authorization: 'Bearer test-token' } })
    );
  }, 20_000);

  it.each(['undeclared', 'shell', 'literal'] as const)(
    'does not find original tools through a %s PATH',
    async (source) => {
      const bin = join(dir, 'node_modules', '.bin');
      await mkdir(bin, { recursive: true });
      const tool = join(bin, 'modelence-verify-local-tool');
      await writeFile(tool, '#!/bin/sh\nexit 0\n');
      await chmod(tool, 0o755);
      const customBin = join(runtimeDir, 'custom-bin');
      await mkdir(customBin);
      const systemPath = [customBin, dirname(process.execPath), '/usr/bin', '/bin'].join(delimiter);
      const path = [bin, `${bin}/../.bin/`, systemPath].join(delimiter);
      vi.stubEnv('PATH', path);
      const record = join(runtimeDir, 'build-path.txt');
      await project(
        { 'server.js': server('Number(process.env.PORT)') },
        {
          build: {
            commands: [
              'if command -v modelence-verify-local-tool > /dev/null; then exit 9; fi',
              `printf '%s' "$PATH" > ${record}`,
            ],
          },
          start: { commands: ['node server.js'] },
        },
        source === 'undeclared'
          ? undefined
          : {
              PATH: {
                scopes: ['build', 'runtime'],
                ...(source === 'literal' ? { value: path } : {}),
              },
            }
      );
      expect(await run()).toBe(true);
      const env = JSON.parse(await readFile(join(runtimeDir, 'env.json'), 'utf8'));
      expect(await readFile(record, 'utf8')).toBe(systemPath);
      expect(env.PATH).toBe(systemPath);
    },
    20_000
  );

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
    expect(path).toBeTruthy();
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

  it.each([
    { resources: {}, count: 0 },
    { resources: { db: { type: 'postgres' } }, count: 0 },
    { resources: { a: { type: 'service' }, b: { type: 'service' } }, count: 2 },
  ])('requires exactly one service ($count found)', async ({ resources, count }) => {
    await writeFile(join(dir, 'modelence.config.json'), JSON.stringify({ resources }));
    await expect(run()).rejects.toThrow(`exactly one service (found ${count})`);
  });
});

describe('processGroupsBelow', () => {
  it("collects the groups of a process and its descendants, never this process's own", () => {
    const own = 500;
    const table = [
      { pid: process.pid, ppid: 1, pgid: own },
      // verify's runtime, in its own group, and the app it detached.
      { pid: 10, ppid: process.pid, pgid: 10 },
      { pid: 11, ppid: 10, pgid: 10 },
      { pid: 20, ppid: 11, pgid: 20 },
      { pid: 21, ppid: 20, pgid: 20 },
      // A descendant that joined this process's group, and an unrelated one.
      { pid: 30, ppid: 21, pgid: own },
      { pid: 40, ppid: 1, pgid: 40 },
    ];
    expect(processGroupsBelow(10, table).sort((a, b) => a - b)).toEqual([10, 20]);
  });

  it('falls back to the process group itself without a process table', () => {
    expect(processGroupsBelow(10, [])).toEqual([10]);
  });
});
