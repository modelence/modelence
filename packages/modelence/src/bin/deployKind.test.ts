import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describeDeployKind, resolveDeployKind } from './deployKind';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'modelence-deploy-kind-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function writePackageJson(manifest: object) {
  await writeFile(join(dir, 'package.json'), JSON.stringify(manifest));
}

describe('resolveDeployKind', () => {
  it('--prebuilt always means the bundle path', async () => {
    await writeFile(join(dir, 'modelence.config.json'), '{}');
    expect(await resolveDeployKind(dir, { prebuilt: true })).toEqual({
      kind: 'bundle',
      reason: 'prebuilt-flag',
    });
  });

  it('a modelence.config.json means a remote source build, framework app or not', async () => {
    await writePackageJson({ dependencies: { modelence: '^0.26.0' } });
    await writeFile(join(dir, 'modelence.config.json'), '{ "resources": {} }');
    expect(await resolveDeployKind(dir, {})).toEqual({ kind: 'source', reason: 'spec-file' });
  });

  it('a framework app without the file keeps the historical bundle path', async () => {
    await writePackageJson({ dependencies: { react: '^19', modelence: '^0.25.0' } });
    const decision = await resolveDeployKind(dir, {});
    expect(decision).toEqual({ kind: 'bundle', reason: 'modelence-dependency' });
    expect(describeDeployKind(decision)).toContain('built locally and uploaded as before');

    await writePackageJson({ devDependencies: { modelence: 'latest' } });
    expect((await resolveDeployKind(dir, {})).kind).toBe('bundle');
  });

  it('anything else without the file goes to the source path, where the missing file is reported', async () => {
    await writePackageJson({ dependencies: { express: '^5' } });
    expect(await resolveDeployKind(dir, {})).toEqual({ kind: 'source', reason: 'default' });
    expect(describeDeployKind({ kind: 'source', reason: 'default' })).toBeNull();

    await rm(join(dir, 'package.json'));
    expect((await resolveDeployKind(dir, {})).kind).toBe('source');

    await writeFile(join(dir, 'package.json'), '{ not json');
    expect((await resolveDeployKind(dir, {})).kind).toBe('source');
  });
});
