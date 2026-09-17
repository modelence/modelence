import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  detectWorkspaceStart,
  findWorkspacePackages,
  parsePackageJsonWorkspaces,
  parsePnpmWorkspaceGlobs,
  pnpmMajorFromLockfile,
} from './workspaces';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'modelence-ws-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function writePackage(rel: string, pkg: object) {
  await mkdir(join(dir, rel), { recursive: true });
  await writeFile(join(dir, rel, 'package.json'), JSON.stringify(pkg));
}

describe('pnpmMajorFromLockfile', () => {
  it('maps lockfile versions to a compatible pnpm major', () => {
    expect(pnpmMajorFromLockfile("lockfileVersion: '9.0'\n\nsettings:\n")).toBe(10);
    expect(pnpmMajorFromLockfile('lockfileVersion: "6.0"\n')).toBe(8);
    expect(pnpmMajorFromLockfile('lockfileVersion: 5.4\n')).toBe(7);
  });

  it('returns undefined for unknown or missing versions', () => {
    expect(pnpmMajorFromLockfile("lockfileVersion: '42.0'\n")).toBeUndefined();
    expect(pnpmMajorFromLockfile('importers: {}\n')).toBeUndefined();
  });
});

describe('workspace globs', () => {
  it('reads the packages list of pnpm-workspace.yaml', () => {
    const yaml = `packages:\n  - 'apps/*'\n  - "packages/**"\n  - '!packages/legacy' # old\nonlyBuiltDependencies:\n  - esbuild\n`;
    expect(parsePnpmWorkspaceGlobs(yaml)).toEqual(['apps/*', 'packages/**', '!packages/legacy']);
  });

  it('reads package.json workspaces in both shapes', () => {
    expect(parsePackageJsonWorkspaces({ workspaces: ['apps/*'] })).toEqual(['apps/*']);
    expect(parsePackageJsonWorkspaces({ workspaces: { packages: ['libs/*'] } })).toEqual([
      'libs/*',
    ]);
    expect(parsePackageJsonWorkspaces({})).toEqual([]);
  });
});

describe('findWorkspacePackages', () => {
  it('lists members matching the globs, honoring negations and nesting', async () => {
    await writePackage('apps/web', { name: 'web', scripts: { start: 'node .' } });
    await writePackage('apps/legacy', { name: 'legacy' });
    await writePackage('packages/ui', { name: '@acme/ui' });
    await writePackage('packages/tools/cli', { name: '@acme/cli' });
    await writePackage('node_modules/dep', { name: 'dep' });
    const members = await findWorkspacePackages(dir, ['apps/*', 'packages/**', '!apps/legacy']);
    expect(members.map((m) => m.name)).toEqual(['web', '@acme/cli', '@acme/ui']);
  });
});

describe('detectWorkspaceStart', () => {
  it('starts the single member with a start script', async () => {
    await writeFile(
      join(dir, 'pnpm-workspace.yaml'),
      "packages:\n  - 'apps/*'\n  - 'packages/*'\n"
    );
    await writePackage('apps/web', { name: 'web', scripts: { start: 'node dist/server.js' } });
    await writePackage('packages/ui', { name: '@acme/ui', scripts: { build: 'tsc' } });
    const result = await detectWorkspaceStart(dir, 'pnpm', {});
    expect(result.startCommand).toBe('pnpm --filter web start');
    expect(result.note).toContain('apps/web/');
  });

  it('asks for a choice when several members can start', async () => {
    await writePackage('apps/web', { name: 'web', scripts: { start: 'node .' } });
    await writePackage('apps/api', { name: 'api', scripts: { start: 'node .' } });
    const result = await detectWorkspaceStart(dir, 'yarn', { workspaces: ['apps/*'] });
    expect(result.startCommand).toBeUndefined();
    expect(result.note).toContain('api, web');
  });

  it('uses the npm workspace syntax', async () => {
    await writePackage('apps/web', { name: 'web', scripts: { start: 'node .' } });
    const result = await detectWorkspaceStart(dir, 'npm', { workspaces: ['apps/*'] });
    expect(result.startCommand).toBe('npm start --workspace web');
  });

  it('finds nothing outside a workspace', async () => {
    expect(await detectWorkspaceStart(dir, 'npm', {})).toEqual({});
  });
});
