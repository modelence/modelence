import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { authenticateCli, DeadCodeError, pollForToken, startSignIn } from './auth';
import { pendingSignInKey, readLogin, readPendingSignIn } from './authCache';
import { signIn, SignInRequiredError } from './signIn';
import { canWaitForSignIn } from './terminal';

vi.mock('./auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./auth')>()),
  authenticateCli: vi.fn(),
  startSignIn: vi.fn(),
  pollForToken: vi.fn(),
}));
vi.mock('./terminal', () => ({ canWaitForSignIn: vi.fn() }));

const host = 'https://cloud.example.com';
const app = { appId: 'app-1' };
const url = 'https://cloud.example.com/cli/auth/verify?code=ABCD-2345&purpose=cli';
const approved = {
  token: 'tok',
  expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  login: {
    appId: 'app-1',
    appAlias: 'shop',
    environments: [
      { id: 'e1', alias: 'prod', access: 'read' as const },
      { id: 'e2', alias: 'staging', access: 'write' as const },
    ],
  },
};
let home: string;
const pendingHere = () => readPendingSignIn(host, pendingSignInKey(process.cwd(), app));

beforeEach(async () => {
  vi.resetAllMocks();
  home = await mkdtemp(join(tmpdir(), 'modelence-home-'));
  vi.stubEnv('MODELENCE_HOME', home);
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  vi.mocked(startSignIn).mockResolvedValue({
    code: 'ABCD-2345',
    verificationUrl: url,
    codeVerifier: 'secret',
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(home, { recursive: true, force: true });
});

describe('with a person at the terminal', () => {
  it('waits for the browser and saves the login for the app', async () => {
    vi.mocked(canWaitForSignIn).mockReturnValue(true);
    vi.mocked(authenticateCli).mockResolvedValue(approved);
    const login = await signIn(host, { app, envAlias: 'prod', services: ['web', 'api'] });
    expect(authenticateCli).toHaveBeenCalledWith(host, {
      purpose: 'cli',
      appId: 'app-1',
      services: ['web', 'api'],
      hint: { envAlias: 'prod' },
    });
    expect(login).toMatchObject({ token: 'tok', appAlias: 'shop' });
    expect((await readLogin(host, app))?.environments).toEqual([
      { alias: 'prod', access: 'read' },
      { alias: 'staging', access: 'write' },
    ]);
  });

  it('refuses a login for another app than the command is for', async () => {
    vi.mocked(canWaitForSignIn).mockReturnValue(true);
    vi.mocked(authenticateCli).mockResolvedValue(approved);
    await expect(signIn(host, { app: { appAlias: 'blog' } })).rejects.toThrow(
      'You signed in to the app shop, but this command is for blog.'
    );
  });

  it('says so when Studio does not describe the login', async () => {
    vi.mocked(canWaitForSignIn).mockReturnValue(true);
    vi.mocked(authenticateCli).mockResolvedValue({ token: 'tok' });
    await expect(signIn(host, { app })).rejects.toThrow('does not support CLI logins');
  });
});

describe('in an agent shell', () => {
  beforeEach(() => {
    vi.mocked(canWaitForSignIn).mockReturnValue(false);
  });

  it('prints the link, remembers the sign-in and stops instead of waiting', async () => {
    await expect(signIn(host, { app, envAlias: 'prod' })).rejects.toBeInstanceOf(
      SignInRequiredError
    );
    expect(authenticateCli).not.toHaveBeenCalled();
    expect(await pendingHere()).toMatchObject({
      code: 'ABCD-2345',
      codeVerifier: 'secret',
      verificationUrl: url,
    });
  });

  it('collects the token on the next run, once approved', async () => {
    await signIn(host, { app }).catch(() => null);
    vi.mocked(pollForToken).mockResolvedValue(approved);
    const login = await signIn(host, { app });
    expect(pollForToken).toHaveBeenCalledWith(host, 'ABCD-2345', 'secret');
    expect(login.token).toBe('tok');
    expect(startSignIn).toHaveBeenCalledTimes(1);
    expect(await pendingHere()).toBeNull();
    expect((await readLogin(host, app))?.token).toBe('tok');
  });

  it('shows the same link again while it is not approved yet', async () => {
    await signIn(host, { app }).catch(() => null);
    vi.mocked(pollForToken).mockResolvedValue(null);
    await expect(signIn(host, { app })).rejects.toThrow(`Still waiting for the sign-in at ${url}`);
    expect(process.stderr.write).toHaveBeenLastCalledWith(`Sign in to Modelence Cloud: ${url}\n`);
    expect(startSignIn).toHaveBeenCalledTimes(1);
  });

  it('starts over with a new link when the code has expired, and says so', async () => {
    await signIn(host, { app }).catch(() => null);
    vi.mocked(pollForToken).mockRejectedValue(new DeadCodeError('expired'));
    await expect(signIn(host, { app })).rejects.toThrow('The previous sign-in link expired');
    expect(startSignIn).toHaveBeenCalledTimes(2);
  });

  // Neither names an app yet; the login approved for one must not deploy the other.
  it('never collects a sign-in started in another project', async () => {
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue('/work/project-a');
    await signIn(host, { app: {} }).catch(() => null);
    cwd.mockReturnValue('/work/project-b');
    vi.mocked(pollForToken).mockResolvedValue(approved);
    await expect(signIn(host, { app: {} })).rejects.toThrow('Nobody is watching this terminal');
    expect(pollForToken).not.toHaveBeenCalled();

    cwd.mockReturnValue('/work/project-a');
    await expect(signIn(host, { app: {} })).resolves.toMatchObject({ appId: 'app-1' });
  });

  it('passes on other errors, keeping the sign-in for the next run', async () => {
    await signIn(host, { app }).catch(() => null);
    vi.mocked(pollForToken).mockRejectedValue(new TypeError('fetch failed'));
    await expect(signIn(host, { app })).rejects.toThrow('fetch failed');
    expect(await pendingHere()).not.toBeNull();
  });
});
