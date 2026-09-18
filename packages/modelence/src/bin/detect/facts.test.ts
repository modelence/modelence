import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { detectAppSpec } from './index';
import { findWorkspaceMembers } from './facts';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'modelence-facts-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function write(path: string, content: string) {
  await mkdir(join(dir, path, '..'), { recursive: true });
  await writeFile(join(dir, path), content);
}

describe('package manager detection', () => {
  it.each([
    ['pnpm@10.4.1', 'npm install -g pnpm@10.4.1 && pnpm install --no-frozen-lockfile'],
    [
      'yarn@4.1.0',
      'corepack enable && corepack prepare yarn@4.1.0 --activate && YARN_ENABLE_IMMUTABLE_INSTALLS=false yarn install',
    ],
  ])('honors %s without a lockfile', async (packageManager, install) => {
    await write(
      'package.json',
      JSON.stringify({ packageManager, scripts: { build: 'vite build' } })
    );
    expect((await detectAppSpec(dir)).spec.build?.install).toBe(install);
  });

  it('uses the declared manager even when an unrelated lockfile remains', async () => {
    await write('package.json', JSON.stringify({ packageManager: 'npm@10.8.2' }));
    await write('pnpm-lock.yaml', "lockfileVersion: '9.0'");
    const detected = await detectAppSpec(dir);
    expect(detected.spec.build?.install).toBe('npm install');
    expect(detected.notes.join(' ')).toContain('ignoring pnpm lockfiles');
  });

  it('requires disambiguation when multiple managers have lockfiles', async () => {
    await write('package.json', '{}');
    await write('pnpm-lock.yaml', "lockfileVersion: '9.0'");
    await write('yarn.lock', '');
    await expect(detectAppSpec(dir)).rejects.toThrow('Conflicting lockfiles');
  });

  it('uses immutable installs for pinned modern Yarn with a lockfile', async () => {
    await write('package.json', JSON.stringify({ packageManager: 'yarn@4.1.0' }));
    await write('yarn.lock', '');
    expect((await detectAppSpec(dir)).spec.build?.install).toContain('yarn install --immutable');
  });
});

describe('workspace discovery', () => {
  it('finds deep declared packages and matches ** at zero or multiple levels', async () => {
    await write('apps/web/package.json', '{"name":"web"}');
    await write('apps/a/b/c/d/web/package.json', '{"name":"deep-web"}');
    await write('assets/nested/package.json', '{"name":"unrelated"}');
    await write('apps/legacy/web/package.json', '{"name":"legacy"}');
    const members = await findWorkspaceMembers(dir, ['apps/**/web', '!apps/legacy']);
    expect(members.map((member) => member.name)).toEqual(['deep-web', 'web']);
  });

  it('does not descend into directories outside a declared prefix', async () => {
    await write('apps/api/package.json', '{"name":"api"}');
    await write('assets/a/b/c/package.json', 'malformed');
    expect((await findWorkspaceMembers(dir, ['apps/*'])).map((member) => member.name)).toEqual([
      'api',
    ]);
  });
});
