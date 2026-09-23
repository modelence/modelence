import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
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

const GIT_IDENTITY = ['-c', 'user.email=test@example.com', '-c', 'user.name=test'];

async function git(...args: string[]) {
  await execFileAsync('git', [...GIT_IDENTITY, ...args], { cwd: dir });
}

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
      const { files, excludedFiles } = await listSourceFiles(dir);
      expect(files).toEqual(['.env.example', 'apps/web/.npmrc']);
      expect(excludedFiles).toEqual(['.env.production', '.npmrc', 'apps/api/.yarnrc.yml']);
    }
  );

  it('uploads environment files committed to git and names them', async () => {
    await git('init', '-q');
    await write('package.json', '{}');
    await write('.env.production', 'VITE_API_URL=https://api.example');
    await write('.env.local', 'SECRET=1');
    await git('add', 'package.json', '.env.production');

    const { files, excludedFiles, committedEnvFiles } = await listSourceFiles(dir);
    expect(files).toEqual(['.env.production', 'package.json']);
    expect(committedEnvFiles).toEqual(['.env.production']);
    expect(excludedFiles).toEqual(['.env.local']);
  });

  it('never uploads Modelence credentials, even when committed', async () => {
    await git('init', '-q');
    await write('package.json', '{}');
    await write('.modelence.env', 'MODELENCE_SERVICE_TOKEN=secret');
    await git('add', '.');

    const { files, excludedFiles } = await listSourceFiles(dir);
    expect(files).toEqual(['package.json']);
    expect(excludedFiles).toEqual(['.modelence.env']);
  });

  it.each([false, true])(
    'keeps symlinks inside the project and reports ones leaving it with git=%s',
    async (useGit) => {
      if (useGit) await git('init', '-q');
      await write('package.json', '{}');
      await write('shared/logo.svg', '<svg/>');
      await mkdir(join(dir, 'apps/web/public'), { recursive: true });
      await symlink('../../../shared', join(dir, 'apps/web/public/shared'));
      await symlink(join(dir, 'shared/logo.svg'), join(dir, 'logo.svg'));
      await symlink(tmpdir(), join(dir, 'outside'));

      const { files, symlinks, skipped } = await listSourceFiles(dir);
      expect(files).toEqual(['package.json', 'shared/logo.svg']);
      expect(symlinks).toEqual([
        { path: 'apps/web/public/shared', target: '../../../shared' },
        { path: 'logo.svg', target: 'shared/logo.svg' },
      ]);
      expect(skipped).toEqual([{ path: 'outside', reason: 'symlink to outside the project' }]);
    }
  );

  it.each([false, true])(
    'excludes symlinks named like excluded directories with git=%s',
    async (useGit) => {
      if (useGit) await git('init', '-q');
      await write('package.json', '{}');
      await write('packages/shared/index.js');
      await mkdir(join(dir, 'apps/web'), { recursive: true });
      await symlink('../../packages', join(dir, 'apps/web/node_modules'));
      await symlink('packages', join(dir, 'node_modules'));
      if (useGit) await git('add', '-f', 'apps/web/node_modules', 'node_modules');

      const { symlinks, excludedFiles } = await listSourceFiles(dir);
      expect(symlinks).toEqual([]);
      expect(excludedFiles).toEqual(['apps/web/node_modules', 'node_modules']);
    }
  );

  it('reports git submodules instead of dropping them silently', async () => {
    await git('init', '-q');
    await write('package.json', '{}');
    await write('vendor/lib/index.js');
    await execFileAsync('git', ['init', '-q'], { cwd: join(dir, 'vendor/lib') });
    await execFileAsync('git', [...GIT_IDENTITY, 'add', '.'], { cwd: join(dir, 'vendor/lib') });
    await execFileAsync('git', [...GIT_IDENTITY, 'commit', '-qm', 'lib'], {
      cwd: join(dir, 'vendor/lib'),
    });
    await git('add', 'package.json', 'vendor/lib');

    const { files, skipped } = await listSourceFiles(dir);
    expect(files).toEqual(['package.json']);
    expect(skipped).toEqual([{ path: 'vendor/lib', reason: 'git submodule' }]);
  });

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

  it('stores symlinks as links', async () => {
    await write('package.json', '{}');
    await write('shared/logo.svg', '<svg/>');
    await symlink('shared/logo.svg', join(dir, 'logo.svg'));
    const zipPath = join(dir, '.modelence', 'tmp', 'source.zip');

    const result = await packSource(dir, zipPath);
    expect(result.fileCount).toBe(3);
    const out = join(dir, 'unpacked');
    await execFileAsync('unzip', ['-q', zipPath, '-d', out]);
    const { stdout } = await execFileAsync('readlink', [join(out, 'logo.svg')]);
    expect(stdout.trim()).toBe('shared/logo.svg');
  });

  it('refuses an empty tree', async () => {
    await expect(packSource(dir, join(dir, 'out.zip'))).rejects.toThrow(/No files/);
  });
});
