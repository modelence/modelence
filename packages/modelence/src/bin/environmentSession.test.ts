import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { authenticateCli } from './auth';
import { readCachedToken, writeCachedToken } from './authCache';
import { openEnvironment, resolveEnvironmentTarget } from './environmentSession';
import { StudioApiError, studioRequest } from './studioApi';

vi.mock('./auth', () => ({ authenticateCli: vi.fn() }));
vi.mock('./studioApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./studioApi')>()),
  studioRequest: vi.fn(),
}));

const request = vi.mocked(studioRequest);
const host = 'https://cloud.example.com';
const options = { app: 'shop', env: 'prod', host };
const inMinutes = (minutes: number) => new Date(Date.now() + minutes * 60 * 1000).toISOString();
let home: string;

beforeEach(async () => {
  vi.resetAllMocks();
  home = await mkdtemp(join(tmpdir(), 'modelence-home-'));
  vi.stubEnv('MODELENCE_HOME', home);
  vi.stubEnv('MODELENCE_TOKEN', '');
  vi.stubEnv('CI', '');
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  request.mockResolvedValue({ ok: true });
  vi.mocked(authenticateCli).mockResolvedValue({ token: 'fresh', expiresAt: inMinutes(60) });
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(home, { recursive: true, force: true });
});

const usedToken = (call = 0) => request.mock.calls[call][2]?.token;

describe('resolveEnvironmentTarget', () => {
  it('takes the app from the flag or the project', () => {
    expect(resolveEnvironmentTarget({ app: 'shop', env: 'prod' }, {}, [])).toEqual({
      appAlias: 'shop',
      envAlias: 'prod',
    });
    expect(resolveEnvironmentTarget({ env: 'prod' }, { appId: 'a1' }, [])).toEqual({
      appId: 'a1',
      envAlias: 'prod',
    });
  });

  it('asks for exactly what is missing', () => {
    expect(() => resolveEnvironmentTarget({}, { appId: 'a1' }, [])).toThrow(
      'Pass --env <environment> to say where.'
    );
    expect(() => resolveEnvironmentTarget({ env: 'prod' }, {}, [])).toThrow('Pass --app <app>');
    expect(() => resolveEnvironmentTarget({ env: 'prod' }, {}, ['https://other'])).toThrow(
      'is for https://other'
    );
  });
});

describe('openEnvironment', () => {
  it("shows Studio's own reason for a 404", async () => {
    await writeCachedToken(host, 'cached', inMinutes(30));
    request.mockRejectedValue(new StudioApiError('No such build', 404, true));
    const session = await openEnvironment(options);
    await expect(session.get('/api/cli/status')).rejects.toThrow('No such build');
  });

  it('keeps the saved login when the rejected token came from the environment', async () => {
    await writeCachedToken(host, 'cached', inMinutes(60));
    vi.stubEnv('MODELENCE_TOKEN', 'from-env');
    request.mockRejectedValue(new StudioApiError('Invalid token', 401));
    const session = await openEnvironment(options);
    await expect(session.get('/api/cli/status')).rejects.toThrow('Set a fresh MODELENCE_TOKEN');
    expect(await readCachedToken(host)).toBe('cached');
  });

  it('uses a saved login for nearly its whole hour, without the browser', async () => {
    await writeCachedToken(host, 'cached', inMinutes(5));
    const session = await openEnvironment(options);
    await session.get('/api/cli/status');
    expect(authenticateCli).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledWith(host, '/api/cli/status', {
      query: { appAlias: 'shop', envAlias: 'prod' },
      token: 'cached',
    });
  });

  it('signs in without a picker when there is no login, and saves it', async () => {
    const session = await openEnvironment(options);
    await session.post('/api/cli/restart', { a: 1 });
    expect(authenticateCli).toHaveBeenCalledWith(host, { purpose: 'deploy', appId: undefined });
    expect(usedToken()).toBe('fresh');
    expect(request.mock.calls[0][2]?.body).toEqual({ appAlias: 'shop', envAlias: 'prod', a: 1 });
    expect(await readCachedToken(host)).toBe('fresh');
  });

  it('signs in once more when the login was rejected, then gives up', async () => {
    await writeCachedToken(host, 'revoked', inMinutes(30));
    request.mockRejectedValue(new StudioApiError('Invalid token', 401));
    const session = await openEnvironment(options);
    await expect(session.get('/api/cli/status')).rejects.toThrow('Invalid token');
    expect(authenticateCli).toHaveBeenCalledTimes(1);
    expect(usedToken(1)).toBe('fresh');
  });

  it('never opens the browser in CI', async () => {
    vi.stubEnv('CI', '1');
    await expect(openEnvironment(options)).rejects.toThrow('Set MODELENCE_TOKEN');
    vi.stubEnv('MODELENCE_TOKEN', 'ci');
    request.mockRejectedValue(new StudioApiError('Invalid token', 401));
    const session = await openEnvironment(options);
    await expect(session.get('/api/cli/status')).rejects.toThrow('Set a fresh MODELENCE_TOKEN');
    expect(authenticateCli).not.toHaveBeenCalled();
  });

  it.each([new StudioApiError('Not found', 404), new SyntaxError('Unexpected token <')])(
    'says so when Studio has no such route',
    async (error) => {
      await writeCachedToken(host, 'cached', inMinutes(30));
      request.mockRejectedValue(error);
      const session = await openEnvironment(options);
      await expect(session.get('/api/cli/status')).rejects.toThrow('does not support this command');
    }
  );
});
