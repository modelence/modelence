import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, stat, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  clearCachedToken,
  clearPendingSignIn,
  getAuthCachePath,
  listCachedTokens,
  pendingSignInKey,
  readLogin,
  readPendingSignIn,
  writeLogin,
  writePendingSignIn,
  type CachedLogin,
} from './authCache';
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
  const other = 'https://other.example.com';
  const inMinutes = (minutes: number) => new Date(Date.now() + minutes * 60 * 1000).toISOString();
  const login = (token: string, appId = 'app-1', expiresAt = inMinutes(60 * 24)): CachedLogin => ({
    token,
    expiresAt,
    appId,
    appAlias: `${appId}-alias`,
    environments: [{ alias: 'prod', access: 'write' }],
  });

  it('returns nothing before a login is saved', async () => {
    expect(await readLogin(host, { appId: 'app-1' })).toBeNull();
  });

  it('keeps one login per app and host, found by id or alias, in a private file', async () => {
    await writeLogin(host, login('tok-1'));
    await writeLogin(host, login('tok-2', 'app-2'));
    await writeLogin(other, login('tok-3'));
    expect((await readLogin(host, { appId: 'app-1' }))?.token).toBe('tok-1');
    expect((await readLogin(host, { appAlias: 'app-2-alias' }))?.token).toBe('tok-2');
    expect((await readLogin(other, { appId: 'app-1' }))?.token).toBe('tok-3');
    expect(await readLogin(host, { appId: 'app-3' })).toBeNull();

    const mode = (await stat(getAuthCachePath())).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("replaces an app's login, and drops expired ones on the way", async () => {
    await writeLogin(host, login('old', 'app-2', inMinutes(-1)));
    await writeLogin(host, login('first'));
    await writeLogin(host, login('second'));
    expect((await readLogin(host, { appId: 'app-1' }))?.token).toBe('second');
    expect((await listCachedTokens(host)).map((entry) => entry.token)).toEqual(['second']);
  });

  it('treats expired and nearly-expired logins as absent', async () => {
    await writeLogin(host, login('soon', 'app-1', inMinutes(30)));
    // Less than a full deploy (40 minutes) left.
    expect(await readLogin(host, { appId: 'app-1' })).toBeNull();
    // Enough for a command that takes seconds.
    expect((await readLogin(host, { appId: 'app-1' }, 60 * 1000))?.token).toBe('soon');
  });

  it('lists tokens saved by earlier CLIs too, for logout to revoke', async () => {
    await writeFile(
      getAuthCachePath(),
      JSON.stringify({ hosts: { [host]: { token: 'legacy', expiresAt: inMinutes(10) } } })
    );
    await writeLogin(other, login('tok-1'));
    expect(await listCachedTokens()).toEqual([
      { host, token: 'legacy' },
      { host: other, token: 'tok-1' },
    ]);
    expect(await listCachedTokens(other)).toEqual([{ host: other, token: 'tok-1' }]);
  });

  it('clears one host or all of them', async () => {
    await writeLogin(host, login('tok-1'));
    await writeLogin(other, login('tok-2'));
    await clearCachedToken(host);
    expect(await readLogin(host, { appId: 'app-1' })).toBeNull();
    expect((await readLogin(other, { appId: 'app-1' }))?.token).toBe('tok-2');
    await clearCachedToken();
    expect(await readLogin(other, { appId: 'app-1' })).toBeNull();
  });

  it('keeps a pending sign-in per host and app until it is collected or expires', async () => {
    const pending = {
      code: 'ABCD-2345',
      codeVerifier: 'secret',
      verificationUrl: 'https://cloud.example.com/cli/auth/verify?code=ABCD-2345',
      expiresAt: inMinutes(30),
    };
    const projectA = pendingSignInKey('/work/a', {});
    await writePendingSignIn(host, projectA, pending);
    expect(await readPendingSignIn(host, projectA)).toEqual(pending);
    // Another new project, or another app, never sees it.
    expect(await readPendingSignIn(host, pendingSignInKey('/work/b', {}))).toBeNull();
    expect(
      await readPendingSignIn(host, pendingSignInKey('/work/a', { appId: 'app-2' }))
    ).toBeNull();

    await clearPendingSignIn(host, projectA);
    expect(await readPendingSignIn(host, projectA)).toBeNull();

    await writePendingSignIn(host, projectA, { ...pending, expiresAt: inMinutes(-1) });
    expect(await readPendingSignIn(host, projectA)).toBeNull();
  });
});

describe('project file', () => {
  it('reads an empty project when the file is missing and merges updates', async () => {
    expect(await readProject(home)).toEqual({});
    await updateProject((project) => ({ ...project, appId: 'app1' }), home);
    await updateProject(
      (project) => ({
        ...project,
        hosts: { 'https://staging.example': { appId: 'app2' } },
      }),
      home
    );
    expect(await readProject(home)).toEqual({
      appId: 'app1',
      hosts: { 'https://staging.example': { appId: 'app2' } },
    });
    expect(await readFile(join(home, '.modelence', 'project.json'), 'utf8')).toMatch(/\n$/);
  });
});
