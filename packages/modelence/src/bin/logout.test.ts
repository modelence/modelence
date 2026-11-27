import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { logout } from './logout';
import { listCachedTokens, writeLogin } from './authCache';
import { StudioApiError, studioRequest } from './studioApi';

vi.mock('./studioApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./studioApi')>()),
  studioRequest: vi.fn(),
}));

const request = vi.mocked(studioRequest);
const host = 'https://cloud.example.com';
const other = 'https://other.example.com';
const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
const login = (token: string) => ({
  token,
  expiresAt: future,
  appId: 'app-1',
  appAlias: 'shop',
  environments: [],
});
const saved = async (where: string) =>
  (await listCachedTokens(where)).map((entry) => entry.token)[0] ?? null;
let home: string;

beforeEach(async () => {
  vi.resetAllMocks();
  home = await mkdtemp(join(tmpdir(), 'modelence-home-'));
  vi.stubEnv('MODELENCE_HOME', home);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  request.mockResolvedValue({ success: true });
  await writeLogin(host, login('tok-1'));
  await writeLogin(other, login('tok-2'));
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(home, { recursive: true, force: true });
});

describe('logout', () => {
  it('revokes every saved token on its host, then forgets them all', async () => {
    await logout({});
    expect(request).toHaveBeenCalledWith(host, '/api/cli/logout', {
      method: 'POST',
      token: 'tok-1',
    });
    expect(request).toHaveBeenCalledWith(other, '/api/cli/logout', {
      method: 'POST',
      token: 'tok-2',
    });
    expect(await saved(host)).toBeNull();
    expect(await saved(other)).toBeNull();
  });

  it('only touches the given host', async () => {
    await logout({ host });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(host, '/api/cli/logout', expect.anything());
    expect(await saved(host)).toBeNull();
    expect(await saved(other)).toBe('tok-2');
  });

  it('matches the host as typed, like deploy does', async () => {
    await logout({ host: 'cloud.example.com/' });
    expect(request).toHaveBeenCalledWith(host, '/api/cli/logout', expect.anything());
    expect(await saved(host)).toBeNull();
    expect(await saved(other)).toBe('tok-2');
  });

  it('still clears the cache when the server rejects or is unreachable', async () => {
    request
      .mockRejectedValueOnce(new StudioApiError('Unknown token', 401))
      .mockRejectedValueOnce(new TypeError('fetch failed'));
    await logout({});
    expect(await saved(host)).toBeNull();
    expect(await saved(other)).toBeNull();
  });

  it('does nothing remotely when nothing is saved', async () => {
    await logout({ host: 'https://unknown.example.com' });
    expect(request).not.toHaveBeenCalled();
  });
});
