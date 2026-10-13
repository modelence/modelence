import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadLocalEnv, mergeLocalEnv } from './localEnv';

describe('mergeLocalEnv', () => {
  it('adds the remote values the process does not have yet', () => {
    expect(
      mergeLocalEnv(
        { DATABASE_URL: 'postgres://db', REDIS_URL: 'redis://r' },
        { A: '1' },
        new Set()
      )
    ).toEqual({ A: '1', DATABASE_URL: 'postgres://db', REDIS_URL: 'redis://r' });
  });

  it('keeps values already set in the process', () => {
    expect(
      mergeLocalEnv(
        { DATABASE_URL: 'postgres://remote' },
        { DATABASE_URL: 'postgres://mine' },
        new Set()
      )
    ).toEqual({ DATABASE_URL: 'postgres://mine' });
  });

  it('leaves out names the project defines in its own env files', () => {
    expect(mergeLocalEnv({ DATABASE_URL: 'postgres://db' }, {}, new Set(['DATABASE_URL']))).toEqual(
      {}
    );
  });

  it('leaves out the platform names and the cloud site URL', () => {
    expect(
      mergeLocalEnv(
        {
          PORT: '8080',
          MODELENCE_SERVICE_TOKEN: 'x',
          SITE_URL: 'https://app.cloud',
          ROOT_URL: 'https://app.cloud',
          MONGODB_URI: 'mongodb://m',
        },
        {},
        new Set()
      )
    ).toEqual({ MONGODB_URI: 'mongodb://m' });
  });

  it('skips empty values and stringifies the rest', () => {
    expect(mergeLocalEnv({ A: null, B: undefined, C: 3 }, {}, new Set())).toEqual({ C: '3' });
  });
});

describe('loadLocalEnv', () => {
  let cwd: string;
  const fetchMock = vi.fn();

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'modelence-local-env-'));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    fetchMock.mockReset();
    await rm(cwd, { recursive: true, force: true });
  });

  async function connect() {
    await writeFile(
      join(cwd, '.modelence.env'),
      'MODELENCE_SERVICE_ENDPOINT="https://cloud.example.com/"\nMODELENCE_SERVICE_TOKEN="tok"\n'
    );
  }

  it('starts without remote values when the project is not connected', async () => {
    expect(await loadLocalEnv(cwd, { A: '1' })).toEqual({ A: '1' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fetches /api/env with the service token and merges the result', async () => {
    await connect();
    await writeFile(join(cwd, '.env.local'), 'REDIS_URL=redis://localhost\n');
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ env: { DATABASE_URL: 'postgres://db', REDIS_URL: 'redis://remote' } })
      )
    );

    expect(await loadLocalEnv(cwd, {})).toEqual({ DATABASE_URL: 'postgres://db' });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://cloud.example.com/api/env',
      expect.objectContaining({ headers: { Authorization: 'Bearer tok' } })
    );
  });

  it('warns and starts without remote values when the request fails', async () => {
    await connect();
    fetchMock.mockResolvedValue(new Response('nope', { status: 401 }));

    expect(await loadLocalEnv(cwd, { A: '1' })).toEqual({ A: '1' });
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('HTTP 401'));
  });

  it('warns when Studio is unreachable', async () => {
    await connect();
    fetchMock.mockRejectedValue(new Error('fetch failed'));

    expect(await loadLocalEnv(cwd, {})).toEqual({});
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('fetch failed'));
  });
});
