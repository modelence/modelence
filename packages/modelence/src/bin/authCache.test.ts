import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, stat, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clearCachedToken, getAuthCachePath, readCachedToken, writeCachedToken } from './authCache';
import { readProject, updateProject } from './project';

let home: string;
let previousHome: string | undefined;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'modelence-home-'));
  previousHome = process.env.MODELENCE_HOME;
  process.env.MODELENCE_HOME = home;
});

afterEach(async () => {
  if (previousHome === undefined) {
    delete process.env.MODELENCE_HOME;
  } else {
    process.env.MODELENCE_HOME = previousHome;
  }
  await rm(home, { recursive: true, force: true });
});

describe('auth cache', () => {
  const host = 'https://cloud.example.com';
  const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();

  it('returns nothing before a login is saved', async () => {
    expect(await readCachedToken(host)).toBeNull();
  });

  it('round-trips a token per host and keeps the file private', async () => {
    await writeCachedToken(host, 'tok-1', future);
    await writeCachedToken('https://other.example.com', 'tok-2', future);
    expect(await readCachedToken(host)).toBe('tok-1');
    expect(await readCachedToken('https://other.example.com')).toBe('tok-2');

    const mode = (await stat(getAuthCachePath())).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('treats expired and nearly-expired tokens as absent', async () => {
    await writeCachedToken(host, 'old', new Date(Date.now() - 1000).toISOString());
    expect(await readCachedToken(host)).toBeNull();
    await writeCachedToken(host, 'soon', new Date(Date.now() + 30 * 1000).toISOString());
    expect(await readCachedToken(host)).toBeNull();
    // A one-hour token with less than a full deploy (40 minutes) left.
    const halfGone = new Date(Date.now() + 35 * 60 * 1000).toISOString();
    await writeCachedToken(host, 'too-short-for-a-deploy', halfGone);
    expect(await readCachedToken(host)).toBeNull();
  });

  it('clears one host or all of them', async () => {
    await writeCachedToken(host, 'tok-1', future);
    await writeCachedToken('https://other.example.com', 'tok-2', future);
    await clearCachedToken(host);
    expect(await readCachedToken(host)).toBeNull();
    expect(await readCachedToken('https://other.example.com')).toBe('tok-2');
    await clearCachedToken();
    expect(await readCachedToken('https://other.example.com')).toBeNull();
  });
});

describe('project file', () => {
  it('reads an empty project when the file is missing and merges updates', async () => {
    expect(await readProject(home)).toEqual({});
    await updateProject({ appId: 'app1' }, home);
    await updateProject(
      { deploy: { environmentId: 'env1', appAlias: 'my-app', envAlias: 'prod' } },
      home
    );
    expect(await readProject(home)).toEqual({
      appId: 'app1',
      deploy: { environmentId: 'env1', appAlias: 'my-app', envAlias: 'prod' },
    });
    expect(await readFile(join(home, '.modelence', 'project.json'), 'utf8')).toMatch(/\n$/);
  });
});
