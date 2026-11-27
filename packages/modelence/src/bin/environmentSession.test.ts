import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { authenticateCli } from './auth';
import { readLogin, writeLogin } from './authCache';
import { openEnvironment, resolveEnvironmentTarget } from './environmentSession';
import { StudioApiError, studioRequest } from './studioApi';

vi.mock('./auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./auth')>()),
  authenticateCli: vi.fn(),
}));
vi.mock('./terminal', () => ({
  isCI: () => Boolean(process.env.CI),
  canWaitForSignIn: () => true,
}));
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
  // A first sign-in records the app in the project's .modelence/project.json.
  vi.spyOn(process, 'cwd').mockReturnValue(home);
  vi.stubEnv('MODELENCE_TOKEN', '');
  vi.stubEnv('CI', '');
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  request.mockResolvedValue({ ok: true });
  vi.mocked(authenticateCli).mockResolvedValue({
    token: 'fresh',
    expiresAt: inMinutes(60 * 24 * 30),
    login: {
      appId: 'app-1',
      appAlias: 'shop',
      environments: [{ id: 'e1', alias: 'prod', access: 'write' }],
    },
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(home, { recursive: true, force: true });
});

const usedToken = (call = 0) => request.mock.calls[call][2]?.token;

function save(token: string, expiresAt: string) {
  return writeLogin(host, {
    token,
    expiresAt,
    appId: 'app-1',
    appAlias: 'shop',
    environments: [{ alias: 'prod', access: 'write' }],
  });
}

const savedToken = async () => (await readLogin(host, { appAlias: 'shop' }, 0))?.token ?? null;

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
    await save('cached', inMinutes(30));
    request.mockRejectedValue(new StudioApiError('No such build', 404, true));
    const session = await openEnvironment(options);
    await expect(session.get('/api/cli/status')).rejects.toThrow('No such build');
  });

  it('keeps the saved login when the rejected token came from the environment', async () => {
    await save('cached', inMinutes(60));
    vi.stubEnv('MODELENCE_TOKEN', 'from-env');
    request.mockRejectedValue(new StudioApiError('Invalid token', 401));
    const session = await openEnvironment(options);
    await expect(session.get('/api/cli/status')).rejects.toThrow(
      'Invalid token Set a MODELENCE_TOKEN that covers this environment.'
    );
    expect(await savedToken()).toBe('cached');
  });

  it('uses the saved login of the app to its last minute, without the browser', async () => {
    await save('cached', inMinutes(5));
    const session = await openEnvironment(options);
    await session.get('/api/cli/status');
    expect(authenticateCli).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledWith(host, '/api/cli/status', {
      query: { appAlias: 'shop', envAlias: 'prod' },
      token: 'cached',
    });
  });

  it('signs in for the app and environment when there is no login, and saves it', async () => {
    const session = await openEnvironment(options);
    await session.post('/api/cli/restart', { a: 1 });
    expect(authenticateCli).toHaveBeenCalledWith(host, {
      purpose: 'cli',
      appId: undefined,
      services: undefined,
      hint: { appAlias: 'shop', envAlias: 'prod' },
    });
    expect(usedToken()).toBe('fresh');
    expect(request.mock.calls[0][2]?.body).toEqual({ appAlias: 'shop', envAlias: 'prod', a: 1 });
    expect(await savedToken()).toBe('fresh');
    expect(JSON.parse(await readFile(join(home, '.modelence', 'project.json'), 'utf8'))).toEqual({
      hosts: { [host]: { appId: 'app-1' } },
    });
  });

  it('signs in once more when the login was rejected, then gives up', async () => {
    await save('revoked', inMinutes(30));
    request.mockRejectedValue(new StudioApiError('Invalid token', 401));
    const session = await openEnvironment(options);
    await expect(session.get('/api/cli/status')).rejects.toThrow('Invalid token');
    expect(authenticateCli).toHaveBeenCalledTimes(1);
    expect(usedToken(1)).toBe('fresh');
  });

  it("says why it signs in again: Studio's reason, such as a read-only login", async () => {
    await save('read-only', inMinutes(30));
    const reason = 'This login can only read shop/prod. Sign in again to allow changes there.';
    request.mockRejectedValueOnce(new StudioApiError(reason, 401)).mockResolvedValue({ ok: true });
    const session = await openEnvironment(options);
    await session.post('/api/cli/restart');
    expect(process.stderr.write).toHaveBeenCalledWith(`${reason} Signing in again.\n`);
    expect(usedToken(1)).toBe('fresh');
  });

  it('never opens the browser in CI', async () => {
    vi.stubEnv('CI', '1');
    await expect(openEnvironment(options)).rejects.toThrow('Set MODELENCE_TOKEN');
    vi.stubEnv('MODELENCE_TOKEN', 'ci');
    request.mockRejectedValue(new StudioApiError('Invalid token', 401));
    const session = await openEnvironment(options);
    await expect(session.get('/api/cli/status')).rejects.toThrow(
      'Set a MODELENCE_TOKEN that covers this environment.'
    );
    expect(authenticateCli).not.toHaveBeenCalled();
  });

  it.each([new StudioApiError('Not found', 404), new SyntaxError('Unexpected token <')])(
    'says so when Studio has no such route',
    async (error) => {
      await save('cached', inMinutes(30));
      request.mockRejectedValue(error);
      const session = await openEnvironment(options);
      await expect(session.get('/api/cli/status')).rejects.toThrow('does not support this command');
    }
  );
});
