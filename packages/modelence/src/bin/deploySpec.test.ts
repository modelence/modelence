import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { prepareSpecLayers } from './deploySpec';
import { resolveTargetFromOptions } from './deployTarget';
import { resolveAppRoot } from './detect/root';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'modelence-plan-'));
  vi.spyOn(console, 'log').mockImplementation(() => {});
  await mkdir(join(dir, 'apps/api'), { recursive: true });
  await writeFile(
    join(dir, 'apps/api/package.json'),
    JSON.stringify({ scripts: { start: 'node server.js' } })
  );
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

describe('app root selection', () => {
  it('reads a configured subdirectory without requiring a root package.json', async () => {
    await writeFile(join(dir, 'modelence.json'), JSON.stringify({ build: { root: 'apps/api' } }));
    const layers = await prepareSpecLayers(dir, {});
    expect(layers.detected.web?.start).toBe('npm start');
    expect(layers.file?.build?.root).toBe('apps/api');
  });

  it('gives the root flag precedence over the file and ignores repository root scripts', async () => {
    await writeFile(join(dir, 'modelence.json'), JSON.stringify({ build: { root: 'missing' } }));
    await writeFile(
      join(dir, 'package.json'),
      JSON.stringify({ scripts: { build: 'unrelated build' } })
    );
    const layers = await prepareSpecLayers(dir, { rootDir: 'apps/api' });
    expect(layers.detected.build?.command).toBeUndefined();
    expect(layers.detected.web?.start).toBe('npm start');
    expect(layers.overrides.build?.root).toBe('apps/api');
  });

  it('rejects traversal and symlinks outside the uploaded tree', async () => {
    await expect(resolveAppRoot(dir, '..')).rejects.toThrow('inside the project');
    await symlink(tmpdir(), join(dir, 'outside'));
    await expect(resolveAppRoot(dir, 'outside')).rejects.toThrow('inside the project');
  });
});

describe('deploy target precedence', () => {
  const project = {
    appId: 'app-id',
    deploy: { environmentId: 'saved-env', appAlias: 'saved-app', envAlias: 'prod' },
  };
  it('uses explicit aliases before the saved target', () => {
    expect(resolveTargetFromOptions({ app: 'other', env: 'staging' }, project)).toEqual({
      appAlias: 'other',
      envAlias: 'staging',
    });
    expect(resolveTargetFromOptions({ env: 'staging' }, project)).toEqual({
      appAlias: 'saved-app',
      envAlias: 'staging',
    });
    expect(resolveTargetFromOptions({}, project)).toEqual({ environmentId: 'saved-env' });
    expect(resolveTargetFromOptions({}, {})).toBeNull();
    expect(() => resolveTargetFromOptions({ app: 'other' }, project)).toThrow('Pass both');
  });
});
