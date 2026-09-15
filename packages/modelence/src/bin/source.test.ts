import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isExcludedPath, listSourceFiles, packSource } from './source';

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
    expect(isExcludedPath('.env')).toBe(false);
  });
});

describe('listSourceFiles', () => {
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
