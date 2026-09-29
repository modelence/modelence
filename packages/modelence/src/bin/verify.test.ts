import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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

const FAKE_RUNTIME = `
const { spawn } = require('child_process');
require('fs').writeFileSync(process.env.RECORD, JSON.stringify(process.env));
const web = JSON.parse(process.env.MODELENCE_WEB);
const app = spawn('sh', ['-c', web.start], { stdio: 'inherit', env: process.env });
app.on('exit', (code) => process.exit(code ?? 1));
process.on('SIGTERM', () => app.kill('SIGTERM'));
`;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'modelence-verify-test-'));
  runtimeDir = await mkdtemp(join(tmpdir(), 'modelence-verify-runtime-'));
  await writeFile(join(runtimeDir, 'runtime.cjs'), FAKE_RUNTIME);
  logged = [];
  vi.spyOn(process, 'cwd').mockReturnValue(dir);
  vi.spyOn(console, 'log').mockImplementation((line: string) => {
    logged.push(String(line));
  });
  vi.stubEnv('RECORD', join(runtimeDir, 'env.json'));
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

  it('fails an app that ignores PORT', async () => {
    await project(
      { 'server.js': server('0') },
      { build: { commands: [] }, start: { commands: ['node server.js'] } }
    );
    expect(await run('2')).toBe(false);
    expect(output()).toMatch(/Nothing answered on PORT \d+ within 2s/);
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

  it('requires exactly one resource', async () => {
    await writeFile(join(dir, 'modelence.config.json'), JSON.stringify({ resources: {} }));
    await expect(run()).rejects.toThrow('exactly one resource (found 0)');
  });
});
