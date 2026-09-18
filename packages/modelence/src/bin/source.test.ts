import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hasRegistryCredentials, isExcludedPath, listSourceFiles, packSource } from './source';

const execFileAsync = promisify(execFile);

/*
  What gets uploaded for a remote build: git's view of the tree when
  available, a walk otherwise — and never credentials or build output.
*/

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'modelence-source-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function write(path: string, content = '') {
  await mkdir(join(dir, path, '..'), { recursive: true });
  await writeFile(join(dir, path), content);
}

describe('isExcludedPath', () => {
  it('drops git internals, dependencies, build output and credentials', () => {
    expect(isExcludedPath('node_modules/x/index.js')).toBe(true);
    expect(isExcludedPath('packages/a/node_modules/x.js')).toBe(true);
    expect(isExcludedPath('.git/HEAD')).toBe(true);
    expect(isExcludedPath('.modelence/build/app.mjs')).toBe(true);
    expect(isExcludedPath('.modelence/tmp/source.zip')).toBe(true);
    expect(isExcludedPath('.modelence.env')).toBe(true);
    expect(isExcludedPath('.modelence.prod.env')).toBe(true);
    expect(isExcludedPath('.modelence/project.json')).toBe(false);
    expect(isExcludedPath('src/server.js')).toBe(false);
    expect(isExcludedPath('.env')).toBe(true);
    expect(isExcludedPath('apps/api/.env.production')).toBe(true);
    expect(isExcludedPath('.env.example')).toBe(false);
    expect(isExcludedPath('.env.production.template')).toBe(false);
  });
});

describe('listSourceFiles', () => {
  it.each([false, true])(
    'excludes credentials with git=%s while retaining portable registry config',
    async (git) => {
      if (git) await execFileAsync('git', ['init', '-q'], { cwd: dir });
      await write('.env.production', 'DATABASE_URL=secret');
      await write('.npmrc', '//registry.npmjs.org/:_authToken=secret');
      await write('apps/api/.yarnrc.yml', 'npmAuthToken: "secret"');
      await write('.env.example', 'DATABASE_URL=');
      await write(
        'apps/web/.npmrc',
        'registry=https://registry.npmjs.org/\n//registry.npmjs.org/:_authToken=${NPM_TOKEN}'
      );
      if (git) await execFileAsync('git', ['add', '.'], { cwd: dir });
      const { files, excludedFiles } = await listSourceFiles(dir);
      expect(files).toEqual(['.env.example', 'apps/web/.npmrc']);
      expect(excludedFiles).toEqual(['.env.production', '.npmrc', 'apps/api/.yarnrc.yml']);
    }
  );

  it('recognizes literal and placeholder registry authentication values', () => {
    expect(hasRegistryCredentials('npmAuthToken: "${NPM_TOKEN}"')).toBe(false);
    expect(hasRegistryCredentials('_password=base64secret')).toBe(true);
    expect(hasRegistryCredentials('# _authToken=example')).toBe(false);
    expect(hasRegistryCredentials('_authToken=${NPM_TOKEN:-literal-secret}')).toBe(true);
    expect(hasRegistryCredentials('"npmAuthToken": "secret"')).toBe(true);
    expect(hasRegistryCredentials('registry=https://user:secret@registry.example/')).toBe(true);
  });
  it('walks the tree with default exclusions outside git', async () => {
    await write('package.json', '{}');
    await write('src/index.js');
    await write('node_modules/dep/index.js');
    await write('.modelence.env', 'SECRET=1');
    await write('.modelence/project.json', '{}');

    const { files, usedGit } = await listSourceFiles(dir);
    expect(usedGit).toBe(false);
    expect(files).toEqual(['.modelence/project.json', 'package.json', 'src/index.js']);
  });

  it('honors .gitignore inside a git repository and includes untracked files', async () => {
    await execFileAsync('git', ['init', '-q'], { cwd: dir });
    await write('.gitignore', 'dist/\n');
    await write('package.json', '{}');
    await write('dist/bundle.js');
    await write('untracked.js');
    await write('.modelence.env', 'SECRET=1');
    await execFileAsync('git', ['add', 'package.json', '.gitignore'], { cwd: dir });

    const { files, usedGit } = await listSourceFiles(dir);
    expect(usedGit).toBe(true);
    expect(files).toEqual(['.gitignore', 'package.json', 'untracked.js']);
  });
});

describe('packSource', () => {
  it('writes a zip with the listed files and reports the size', async () => {
    await write('package.json', '{"name":"x"}');
    await write('src/index.js', 'console.log(1)');
    const zipPath = join(dir, '.modelence', 'tmp', 'source.zip');

    const result = await packSource(dir, zipPath);
    expect(result.fileCount).toBe(2);
    expect(result.sizeBytes).toBeGreaterThan(0);

    const { stdout } = await execFileAsync('unzip', ['-Z1', zipPath]);
    expect(stdout.trim().split('\n').sort()).toEqual(['package.json', 'src/index.js']);
  });

  it('refuses an empty tree', async () => {
    await expect(packSource(dir, join(dir, 'out.zip'))).rejects.toThrow(/No files/);
  });
});
