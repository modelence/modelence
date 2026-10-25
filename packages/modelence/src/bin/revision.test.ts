import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readSourceRevision } from './revision';

const execFileAsync = promisify(execFile);
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'modelence-revision-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function git(...args: string[]) {
  const { stdout } = await execFileAsync(
    'git',
    ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args],
    { cwd: dir }
  );
  return stdout.trim();
}

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

  it('leaves out what it cannot read', async () => {
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'app' }));
    expect(await readSourceRevision(dir)).toEqual({});
  });

  it('leaves out the SHA in a repository with no commits yet', async () => {
    await writeFile(join(dir, 'package.json'), JSON.stringify({ version: '0.1.0' }));
    await git('init', '-q');
    expect(await readSourceRevision(dir)).toEqual({ appVersion: '0.1.0' });
  });
});
