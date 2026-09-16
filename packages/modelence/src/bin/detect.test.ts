import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectBuildPlan, parseNodeMajor, parseProcfileWebCommand } from './detect';

/*
  Detection feeds the defaults Studio builds with, so each convention it
  honors (lockfiles, scripts, Procfile, engines, modelence.config.ts) is
  pinned here with a fixture project.
*/

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'modelence-detect-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function writeProject(files: Record<string, string | object>) {
  for (const [name, content] of Object.entries(files)) {
    await writeFile(
      join(dir, name),
      typeof content === 'string' ? content : JSON.stringify(content)
    );
  }
}

describe('detectBuildPlan', () => {
  it('uses npm ci, the build script and npm start for a locked npm project', async () => {
    await writeProject({
      'package.json': {
        scripts: { build: 'tsc', start: 'node dist/server.js' },
        engines: { node: '>=20' },
      },
      'package-lock.json': '{}',
    });
    const plan = await detectBuildPlan(dir);
    expect(plan).toMatchObject({
      preset: 'node',
      packageManager: 'npm',
      nodeVersion: '20',
      installCommand: 'npm ci',
      buildCommand: 'npm run build',
      startCommand: 'npm start',
    });
    expect(plan.notes).toEqual([]);
  });

  it('falls back to npm install without a lockfile and leaves missing commands undefined', async () => {
    await writeProject({ 'package.json': { scripts: {} } });
    const plan = await detectBuildPlan(dir);
    expect(plan.installCommand).toBe('npm install');
    expect(plan.buildCommand).toBeUndefined();
    expect(plan.startCommand).toBeUndefined();
    expect(plan.notes.join('\n')).toMatch(/package-lock/);
    expect(plan.notes.join('\n')).toMatch(/start/);
  });

  it('prefers the Procfile web command over the start script', async () => {
    await writeProject({
      'package.json': { scripts: { start: 'node index.js' } },
      Procfile: 'release: npm run migrate\nweb: node server.js --port $PORT\n',
    });
    const plan = await detectBuildPlan(dir);
    expect(plan.startCommand).toBe('node server.js --port $PORT');
  });

  it('switches commands to pnpm and yarn by lockfile', async () => {
    await writeProject({
      'package.json': { scripts: { build: 'x', start: 'y' } },
      'pnpm-lock.yaml': '',
    });
    expect(await detectBuildPlan(dir)).toMatchObject({
      packageManager: 'pnpm',
      installCommand: 'npm install -g pnpm && pnpm install --frozen-lockfile',
      buildCommand: 'pnpm run build',
      startCommand: 'pnpm start',
    });

    await rm(join(dir, 'pnpm-lock.yaml'));
    await writeProject({ 'yarn.lock': '' });
    expect(await detectBuildPlan(dir)).toMatchObject({
      packageManager: 'yarn',
      installCommand: 'yarn install --frozen-lockfile',
      buildCommand: 'yarn build',
      startCommand: 'yarn start',
    });
  });

  it('treats a Vite project without a start script as a static site', async () => {
    await writeProject({
      'package.json': {
        scripts: { dev: 'vite', build: 'vite build', preview: 'vite preview' },
        devDependencies: { vite: '^5.0.0' },
      },
      'package-lock.json': '{}',
      'index.html': '<div id="root"></div>',
    });
    const plan = await detectBuildPlan(dir);
    expect(plan).toMatchObject({
      preset: 'static',
      installCommand: 'npm ci',
      buildCommand: 'npm run build',
      outputDirectory: 'dist',
    });
    expect(plan.startCommand).toBeUndefined();
    expect(plan.notes.join('\n')).toMatch(/served from dist/);
  });

  it('keeps the node preset when a start script exists alongside vite', async () => {
    await writeProject({
      'package.json': {
        scripts: { build: 'vite build', start: 'node server.js' },
        devDependencies: { vite: '^5.0.0' },
      },
    });
    expect((await detectBuildPlan(dir)).preset).toBe('node');
  });

  it('recognizes a Modelence app by its config file', async () => {
    await writeProject({
      'package.json': { scripts: { build: 'modelence build', start: 'modelence start' } },
      'modelence.config.ts': 'export default {};',
    });
    expect((await detectBuildPlan(dir)).preset).toBe('modelence');
  });

  it('fails clearly without a package.json', async () => {
    await expect(detectBuildPlan(dir)).rejects.toThrow(/package.json/);
  });
});

describe('parseNodeMajor', () => {
  it('extracts the first supported major from a range', () => {
    expect(parseNodeMajor('22')).toBe('22');
    expect(parseNodeMajor('>=20.10 <23')).toBe('20');
    expect(parseNodeMajor('^18.19.0')).toBe('18');
    expect(parseNodeMajor('22.x')).toBe('22');
    expect(parseNodeMajor('16')).toBeUndefined();
    expect(parseNodeMajor(undefined)).toBeUndefined();
  });
});

describe('parseProcfileWebCommand', () => {
  it('finds the web process and ignores others', () => {
    expect(parseProcfileWebCommand('worker: node w.js\nweb:  node s.js  \n')).toBe('node s.js');
    expect(parseProcfileWebCommand('worker: node w.js')).toBeUndefined();
  });
});
