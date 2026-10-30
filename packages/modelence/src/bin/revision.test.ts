import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readSourceRevision } from './revision';
import { testGit } from './testGit';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'modelence-revision-'));
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

const git = testGit(() => dir);

describe('readSourceRevision', () => {
  it('reads the package.json version and the git HEAD', async () => {
    await writeFile(join(dir, 'package.json'), JSON.stringify({ version: '1.2.3' }));
    await git('init', '-q');
    await git('add', '.');
    await git('commit', '-q', '-m', 'init');
    expect(await readSourceRevision(dir)).toEqual({
      appVersion: '1.2.3',
      commitSha: await git('rev-parse', 'HEAD'),
    });
  });

  it('leaves out the SHA when the working tree has changes', async () => {
    await writeFile(join(dir, 'package.json'), JSON.stringify({ version: '1.2.3' }));
    await git('init', '-q');
    await git('add', '.');
    await git('commit', '-q', '-m', 'init');
    await writeFile(join(dir, 'server.js'), 'console.log(1);');
    expect(await readSourceRevision(dir)).toEqual({ appVersion: '1.2.3' });
  });

  it('leaves out what it cannot read', async () => {
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'app' }));
    expect(await readSourceRevision(dir)).toEqual({});
    // Not a git repository is normal, so there is nothing to warn about.
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('leaves out the SHA in a repository with no commits yet', async () => {
    await writeFile(join(dir, 'package.json'), JSON.stringify({ version: '0.1.0' }));
    await git('init', '-q');
    expect(await readSourceRevision(dir)).toEqual({ appVersion: '0.1.0' });
    expect(console.warn).not.toHaveBeenCalled();
  });
});
