import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { logout } from './logout';
import { readCachedToken, writeCachedToken } from './authCache';
import { StudioApiError, studioRequest } from './studioApi';

vi.mock('./studioApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./studioApi')>()),
  studioRequest: vi.fn(),
}));

const request = vi.mocked(studioRequest);
const host = 'https://cloud.example.com';
const other = 'https://other.example.com';
const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
let home: string;

beforeEach(async () => {
  vi.resetAllMocks();
  home = await mkdtemp(join(tmpdir(), 'modelence-home-'));
  vi.stubEnv('MODELENCE_HOME', home);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  request.mockResolvedValue({ success: true });
  await writeCachedToken(host, 'tok-1', future);
  await writeCachedToken(other, 'tok-2', future);
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
    expect(await readCachedToken(host)).toBeNull();
    expect(await readCachedToken(other)).toBeNull();
  });

  it('only touches the given host', async () => {
    await logout({ host });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(host, '/api/cli/logout', expect.anything());
    expect(await readCachedToken(host)).toBeNull();
    expect(await readCachedToken(other)).toBe('tok-2');
  });

  it('still clears the cache when the server rejects or is unreachable', async () => {
    request
      .mockRejectedValueOnce(new StudioApiError('Unknown token', 401))
      .mockRejectedValueOnce(new TypeError('fetch failed'));
    await logout({});
    expect(await readCachedToken(host)).toBeNull();
    expect(await readCachedToken(other)).toBeNull();
  });

  it('does nothing remotely when nothing is saved', async () => {
    await logout({ host: 'https://unknown.example.com' });
    expect(request).not.toHaveBeenCalled();
  });
});
