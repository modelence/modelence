import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { deploy } from './deploy';
import { authenticateCli } from './auth';
import { StudioApiError, studioRequest } from './studioApi';
import { followDeploy, waitForEnvironmentReady } from './deployStatus';
import { build } from './build';
import { getProjectPath } from './config';
import { isCI } from './terminal';

vi.mock('./auth', () => ({ authenticateCli: vi.fn() }));
vi.mock('./build', () => ({ build: vi.fn() }));
vi.mock('./terminal', () => ({ isCI: vi.fn() }));
vi.mock('./config', () => ({ loadEnv: vi.fn(), getProjectPath: vi.fn() }));
vi.mock('./studioApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./studioApi')>()),
  studioRequest: vi.fn(),
}));

const request = vi.mocked(studioRequest);
const options = { host: 'https://studio.example', app: 'app', env: 'prod' };
const spec = {
  resources: {
    app: {
      type: 'service',
      build: { commands: ['npm ci'] },
      start: { commands: ['node server.js'] },
    },
  },
};
const picked = { appId: 'app-id', appAlias: 'app', environmentId: 'env-id', envAlias: 'prod' };
const completed = {
  status: 'deploy-completed',
  logs: [],
  logCursor: null,
  errors: [],
  rolloutProgress: null,
  siteUrl: 'https://site.example',
};
let dir: string;
let project: string;
let upload: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  vi.resetAllMocks();
  dir = await mkdtemp(join(tmpdir(), 'modelence-deploy-'));
  project = join(dir, 'project');
  await mkdir(project);
  await writeFile(join(project, 'package.json'), JSON.stringify({ name: 'app' }));
  await writeFile(join(project, 'modelence.config.json'), JSON.stringify(spec));
  vi.spyOn(process, 'cwd').mockReturnValue(project);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  vi.stubEnv('MODELENCE_TOKEN', 'original-token');
  vi.stubEnv('MODELENCE_HOME', join(dir, 'auth'));
  vi.mocked(authenticateCli).mockResolvedValue({ token: 'browser-token', target: picked });
  vi.mocked(isCI).mockReturnValue(false);
  upload = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
  vi.stubGlobal('fetch', upload);
  request.mockImplementation(async (_host, path) => {
    if (path === '/api/upload-bundle')
      return {
        uploadUrl: 'https://upload.example/source',
        bundleName: 'source.zip',
        appAlias: 'app',
        envAlias: 'prod',
        environmentId: 'env-id',
      };
    if (path === '/api/environment/status') return { status: 'ready' };
    if (path === '/api/deploy')
      return {
        deploymentUrl: 'https://studio.example/build',
        appAlias: 'app',
        envAlias: 'prod',
        environmentId: 'env-id',
        buildId: 'build-id',
      };
    if (path === '/api/deploy/status') return completed;
    throw new Error(`Unexpected route ${path}`);
  });
});

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  process.exitCode = 0;
  await rm(dir, { recursive: true, force: true });
});

describe('deploy orchestration', () => {
  it('uploads a readable file-backed archive, starts once, follows the build, and cleans up', async () => {
    upload.mockImplementation(async (_url, init: RequestInit) => {
      expect(init.body).toBeInstanceOf(Blob);
      const bytes = new Uint8Array(await (init.body as Blob).arrayBuffer());
      expect([...bytes.slice(0, 2)]).toEqual([80, 75]); // ZIP signature
      return new Response(null, { status: 200 });
    });
    await deploy(options);
    expect(request.mock.calls.filter(([, path]) => path === '/api/deploy')).toHaveLength(1);
    expect(request).toHaveBeenCalledWith(
      options.host,
      '/api/deploy/status',
      expect.objectContaining({
        query: { environmentId: 'env-id', buildId: 'build-id' },
      })
    );
    await expect(access(join(project, '.modelence/tmp/source.zip'))).rejects.toThrow();
  });

  it('sends modelence.config.json as the spec and nothing else about the project', async () => {
    await deploy(options);
    const [, , args] = request.mock.calls.find(([, path]) => path === '/api/deploy')!;
    expect(args?.body).toEqual({
      environmentId: 'env-id',
      bundleName: 'source.zip',
      kind: 'source',
      spec,
    });
    expect(args?.body).not.toHaveProperty('overrides');
    expect(args?.body).not.toHaveProperty('detected');
  });

  it('names the files left out of the upload', async () => {
    await writeFile(join(project, '.env'), 'SECRET=1');
    await deploy(options);
    expect(console.log).toHaveBeenCalledWith(expect.stringMatching(/^Not uploaded .*: \.env$/));
  });

  it('stops before signing in or uploading when modelence.config.json is missing', async () => {
    await rm(join(project, 'modelence.config.json'));
    vi.stubEnv('MODELENCE_TOKEN', '');
    await expect(deploy(options)).rejects.toThrow('modelence.config.json not found in');
    expect(authenticateCli).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
    await expect(access(join(project, '.modelence/tmp/source.zip'))).rejects.toThrow();
  });

  it('keeps the historical bundle path for a Modelence app without modelence.config.json', async () => {
    await rm(join(project, 'modelence.config.json'));
    await writeFile(
      join(project, 'package.json'),
      JSON.stringify({ name: 'app', dependencies: { modelence: '^0.25.0' } })
    );
    vi.mocked(getProjectPath).mockImplementation((...parts: string[]) => join(project, ...parts));
    await deploy(options);
    expect(build).toHaveBeenCalledTimes(1);
    const [, , uploadArgs] = request.mock.calls.find(([, path]) => path === '/api/upload-bundle')!;
    expect(uploadArgs?.body).toMatchObject({ kind: 'bundle' });
    const [, , deployArgs] = request.mock.calls.find(([, path]) => path === '/api/deploy')!;
    expect(deployArgs?.body).toMatchObject({ kind: 'bundle' });
    expect((deployArgs?.body as { spec?: unknown })?.spec).toBeUndefined();
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('built locally and uploaded as before')
    );
  });

  // Its declarations reach the picker's variables step and the CI check.
  it('sends modelence.config.json with a --prebuilt deploy too', async () => {
    const declared = { ...spec, env: { DATABASE_URL: { type: 'secret' } } };
    await writeFile(join(project, 'modelence.config.json'), JSON.stringify(declared));
    vi.mocked(getProjectPath).mockImplementation((...parts: string[]) => join(project, ...parts));
    await deploy({ ...options, prebuilt: true });
    const [, , deployArgs] = request.mock.calls.find(([, path]) => path === '/api/deploy')!;
    expect(deployArgs?.body).toMatchObject({ kind: 'bundle', spec: declared });
    expect(authenticateCli).toHaveBeenCalledWith(
      options.host,
      expect.objectContaining({ env: declared.env })
    );
  });

  it('reauthorizes once when the upload authorization is rejected', async () => {
    vi.mocked(authenticateCli)
      .mockResolvedValueOnce({ token: 'browser-token', target: picked })
      .mockResolvedValueOnce({ token: 'refreshed-token' });
    request.mockRejectedValueOnce(new StudioApiError('Expired', 401));
    await deploy(options);
    // The target is already picked: the second visit only authorizes.
    expect(authenticateCli).toHaveBeenCalledTimes(2);
    expect(vi.mocked(authenticateCli).mock.calls[1][1]).toEqual({
      purpose: 'deploy',
      appId: undefined,
    });
    expect(request.mock.calls.filter(([, path]) => path === '/api/deploy')).toHaveLength(1);
    expect(request).toHaveBeenCalledWith(
      options.host,
      '/api/upload-bundle',
      expect.objectContaining({ token: 'refreshed-token' })
    );
  });

  it('resumes polling after authorization expires without starting another build', async () => {
    vi.mocked(authenticateCli)
      .mockResolvedValueOnce({ token: 'browser-token', target: picked })
      .mockResolvedValueOnce({ token: 'refreshed-token' });
    const original = request.getMockImplementation()!;
    let polls = 0;
    request.mockImplementation(async (host, path, args) => {
      if (path === '/api/deploy/status' && polls++ === 0) throw new StudioApiError('Expired', 401);
      return original(host, path, args);
    });
    await deploy(options);
    expect(authenticateCli).toHaveBeenCalledTimes(2);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(request.mock.calls.filter(([, path]) => path === '/api/deploy')).toHaveLength(1);
    expect(request).toHaveBeenLastCalledWith(
      options.host,
      '/api/deploy/status',
      expect.objectContaining({ token: 'refreshed-token' })
    );
  });

  it('does not start a deployment when the source upload fails', async () => {
    upload.mockResolvedValue(new Response(null, { status: 500, statusText: 'Upload failed' }));
    await expect(deploy(options)).rejects.toThrow('Failed to upload');
    expect(request.mock.calls.some(([, path]) => path === '/api/deploy')).toBe(false);
    await expect(access(join(project, '.modelence/tmp/source.zip'))).rejects.toThrow();
  });

  it('signs the upload URL again after waiting for the environment to provision', async () => {
    const original = request.getMockImplementation()!;
    let statusCalls = 0;
    let urls = 0;
    request.mockImplementation(async (host, path, args) => {
      if (path === '/api/environment/status') {
        return { status: statusCalls++ === 0 ? 'provisioning' : 'ready' };
      }
      if (path === '/api/upload-bundle') {
        return {
          uploadUrl: `https://upload.example/source?sig=${urls++}`,
          bundleName: 'source.zip',
          appAlias: 'app',
          envAlias: 'prod',
          environmentId: 'env-id',
        };
      }
      return original(host, path, args);
    });
    await deploy(options);
    // Signed once before the wait to resolve the target, once after it.
    expect(request.mock.calls.filter(([, path]) => path === '/api/upload-bundle')).toHaveLength(2);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload.mock.calls[0][0]).toBe('https://upload.example/source?sig=1');
  });

  it('signs the upload URL once when the environment is already ready', async () => {
    await deploy(options);
    expect(request.mock.calls.filter(([, path]) => path === '/api/upload-bundle')).toHaveLength(1);
  });

  it('reports the storage error code when an upload is rejected', async () => {
    upload.mockResolvedValue(
      new Response(
        '<?xml version="1.0"?><Error><Code>AccessDenied</Code>' +
          '<Message>Request has expired</Message></Error>',
        { status: 403, statusText: 'Forbidden' }
      )
    );
    await expect(deploy(options)).rejects.toThrow(
      'Failed to upload: Forbidden (AccessDenied: Request has expired)'
    );
  });

  it('cleans up the archive when browser authentication fails', async () => {
    vi.stubEnv('MODELENCE_TOKEN', '');
    vi.mocked(authenticateCli).mockRejectedValue(new Error('Authentication timed out'));
    await expect(deploy(options)).rejects.toThrow('Authentication timed out');
    await expect(access(join(project, '.modelence/tmp/source.zip'))).rejects.toThrow();
  });

  it('stops before uploading when Studio does not report the environment', async () => {
    const original = request.getMockImplementation()!;
    request.mockImplementation(async (host, path, args) =>
      path === '/api/upload-bundle'
        ? { uploadUrl: 'https://upload.example/source', bundleName: 'source.zip' }
        : original(host, path, args)
    );
    await expect(deploy(options)).rejects.toThrow('Modelence Cloud is too old for this CLI');
    expect(upload).not.toHaveBeenCalled();
    expect(request.mock.calls.some(([, path]) => path === '/api/deploy')).toBe(false);
  });

  it('reports a failed rollout through the exit code', async () => {
    const original = request.getMockImplementation()!;
    request.mockImplementation(async (host, path, args) =>
      path === '/api/deploy/status'
        ? { ...completed, status: 'deploy-failed', errors: ['Health check failed'] }
        : original(host, path, args)
    );
    await deploy(options);
    expect(process.exitCode).toBe(1);
  });

  // The app's own crash ("DATABASE_URL must be set") says nothing about where to set it.
  it('names declared variables without a value and where to set them', async () => {
    const configUrl = 'https://studio.example/environments/env-id/config';
    const original = request.getMockImplementation()!;
    request.mockImplementation(async (host, path, args) => {
      if (path === '/api/deploy') {
        return {
          ...((await original(host, path, args)) as object),
          missingEnvVars: ['DATABASE_URL'],
          configUrl,
        };
      }
      if (path === '/api/deploy/status') {
        return {
          ...completed,
          status: 'deploy-failed',
          errors: [],
          missingEnvVars: ['DATABASE_URL', 'CLERK_SECRET_KEY'],
          configUrl,
        };
      }
      return original(host, path, args);
    });
    await deploy(options);
    expect(console.warn).toHaveBeenCalledWith(
      `Warning: DATABASE_URL is declared in modelence.config.json but has no value in this environment. Set it at ${configUrl}`
    );
    expect(vi.mocked(console.error).mock.calls.at(-1)?.[0]).toBe(
      `DATABASE_URL, CLERK_SECRET_KEY are declared in modelence.config.json but have no value in this environment. Set them at ${configUrl}, then deploy again.`
    );
    expect(process.exitCode).toBe(1);
  });

  // A failing build is not fixed by setting variables; its errors stay last on screen.
  it('names missing variables before other errors, without suggesting a redeploy', async () => {
    const configUrl = 'https://studio.example/environments/env-id/config';
    const original = request.getMockImplementation()!;
    request.mockImplementation(async (host, path, args) =>
      path === '/api/deploy/status'
        ? {
            ...completed,
            status: 'build-failed',
            errors: ['npm ci failed'],
            missingEnvVars: ['DATABASE_URL'],
            configUrl,
          }
        : original(host, path, args)
    );
    await deploy(options);
    const errors = vi.mocked(console.error).mock.calls.map(([line]) => line);
    expect(errors).toEqual([
      `DATABASE_URL is declared in modelence.config.json but has no value in this environment. Set it at ${configUrl}`,
      '  npm ci failed',
    ]);
  });
});

// The app recorded for a project, optionally with the environment earlier
// CLIs saved next to it.
async function saveProject(
  appId: string,
  host: string | null = options.host,
  legacyEnvAlias?: string
) {
  await mkdir(join(project, '.modelence'), { recursive: true });
  const entry = {
    appId,
    ...(legacyEnvAlias
      ? {
          deploy: {
            environmentId: `${legacyEnvAlias}-id`,
            appAlias: 'app',
            envAlias: legacyEnvAlias,
          },
        }
      : {}),
  };
  await writeFile(
    join(project, '.modelence/project.json'),
    JSON.stringify(host ? { hosts: { [host]: entry } } : entry)
  );
}

async function readSavedProject() {
  try {
    return JSON.parse(await readFile(join(project, '.modelence/project.json'), 'utf8'));
  } catch {
    return null;
  }
}

describe('in CI', () => {
  beforeEach(() => {
    vi.mocked(isCI).mockReturnValue(true);
  });

  it('fails at once without a target instead of opening the browser', async () => {
    await expect(deploy({ host: options.host })).rejects.toThrow('pass --app and --env');
    expect(authenticateCli).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
    await expect(access(join(project, '.modelence/tmp/source.zip'))).rejects.toThrow();
  });

  it('fails at once without a token', async () => {
    vi.stubEnv('MODELENCE_TOKEN', '');
    await expect(deploy(options)).rejects.toThrow(/set MODELENCE_TOKEN\.$/);
    expect(authenticateCli).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it('fails instead of signing in again when the token is rejected', async () => {
    request.mockRejectedValueOnce(new StudioApiError('Expired', 401));
    await expect(deploy(options)).rejects.toThrow('Set a fresh MODELENCE_TOKEN');
    expect(authenticateCli).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });

  it('deploys to explicit flags without the browser', async () => {
    await saveProject('saved-app-id');
    await deploy(options);
    expect(authenticateCli).not.toHaveBeenCalled();
    const [, , args] = request.mock.calls.find(([, path]) => path === '/api/upload-bundle')!;
    expect(args?.body).toMatchObject({ appAlias: 'app', envAlias: 'prod' });
  });

  // The same code goes to staging and production: only --env says which.
  it('deploys the saved app to the environment named with --env', async () => {
    await saveProject('app-id');
    await deploy({ host: options.host, env: 'staging' });
    await deploy({ host: options.host, env: 'prod' });
    const bodies = request.mock.calls
      .filter(([, path]) => path === '/api/upload-bundle')
      .map(([, , args]) => args?.body);
    expect(bodies).toEqual([
      { appId: 'app-id', envAlias: 'staging', kind: 'source' },
      { appId: 'app-id', envAlias: 'prod', kind: 'source' },
    ]);
  });

  it('asks only for --env when the app is saved', async () => {
    await saveProject('app-id');
    await expect(deploy({ host: options.host })).rejects.toThrow(
      /To deploy from here, pass --env\.$/
    );
    expect(request).not.toHaveBeenCalled();
  });

  it('never deploys to an environment saved by an earlier CLI', async () => {
    await saveProject('app-id', options.host, 'staging');
    await expect(deploy({ host: options.host })).rejects.toThrow('pass --env');
    expect(request).not.toHaveBeenCalled();
  });

  // Nobody picked anything, so nobody was asked for the variables either.
  it('has Studio refuse the deploy while required variables have no value', async () => {
    await deploy(options);
    const [, , args] = request.mock.calls.find(([, path]) => path === '/api/deploy')!;
    expect(args?.body).toMatchObject({ checkEnv: true });
  });

  it('skips that check with --skip-env-check', async () => {
    await deploy({ ...options, skipEnvCheck: true });
    const [, , args] = request.mock.calls.find(([, path]) => path === '/api/deploy')!;
    expect(args?.body).not.toHaveProperty('checkEnv');
  });
});

describe('deploy target', () => {
  // A project can have several targets; agents run without a TTY and still pick.
  it('picks the target in the browser on every deploy, preselecting flags', async () => {
    await saveProject('app-id');
    await deploy(options);
    expect(authenticateCli).toHaveBeenCalledWith(
      options.host,
      expect.objectContaining({
        pick: 'deploy',
        appId: 'app-id',
        hint: { appAlias: 'app', envAlias: 'prod' },
        env: undefined,
      })
    );
    const [, , args] = request.mock.calls.find(([, path]) => path === '/api/upload-bundle')!;
    expect(args?.body).toMatchObject({ environmentId: 'env-id' });
    const [, , deployArgs] = request.mock.calls.find(([, path]) => path === '/api/deploy')!;
    expect(deployArgs?.body).not.toHaveProperty('checkEnv');
  });

  it('preselects only the saved app, never an environment', async () => {
    await saveProject('app-id', options.host, 'staging');
    await deploy({ host: options.host });
    expect(authenticateCli).toHaveBeenCalledWith(
      options.host,
      expect.objectContaining({ pick: 'deploy', appId: 'app-id', hint: undefined })
    );
  });

  it('preselects the saved app with the environment named by --env', async () => {
    await saveProject('app-id');
    await deploy({ host: options.host, env: 'staging' });
    expect(authenticateCli).toHaveBeenCalledWith(
      options.host,
      expect.objectContaining({ hint: { appId: 'app-id', envAlias: 'staging' } })
    );
  });

  it('records only the app picked in the browser', async () => {
    await deploy({ host: options.host });
    expect(await readSavedProject()).toEqual({
      hosts: { [options.host]: { appId: 'app-id' } },
    });
  });

  it('records a Modelence Cloud app at the top level, where released CLIs read it', async () => {
    await deploy({ host: 'https://cloud.modelence.com' });
    expect(await readSavedProject()).toEqual({ appId: 'app-id' });
  });

  it('drops the environment an earlier CLI saved', async () => {
    await saveProject('app-id', null, 'prod');
    await deploy({ host: 'https://cloud.modelence.com' });
    expect(await readSavedProject()).toEqual({ appId: 'app-id' });
  });

  it('keeps apps for different Studios side by side', async () => {
    await saveProject('cloud-app-id', null);
    await deploy({ host: options.host });
    expect(await readSavedProject()).toEqual({
      appId: 'cloud-app-id',
      hosts: { [options.host]: { appId: 'app-id' } },
    });
  });

  it('says which Studio the saved app is for when it does not apply', async () => {
    await saveProject('app-id', 'https://other.example');
    vi.mocked(isCI).mockReturnValue(true);
    await expect(deploy({ host: options.host })).rejects.toThrow(
      'is for https://other.example, not this Studio. Pass --host to deploy there.'
    );
    await expect(deploy({ host: options.host, env: 'prod' })).rejects.toThrow(
      '--env needs --app here: the app saved in .modelence/project.json is for https://other.example'
    );
  });

  // App ids only mean something on the Studio they were picked on.
  it('ignores an app saved for another host and picks one in the browser', async () => {
    await saveProject('other-app-id', 'https://other.example');
    await deploy({ host: options.host });
    expect(authenticateCli).toHaveBeenCalledWith(
      options.host,
      expect.objectContaining({ pick: 'deploy', appId: undefined })
    );
    const [, , args] = request.mock.calls.find(([, path]) => path === '/api/upload-bundle')!;
    expect(args?.body).toMatchObject({ environmentId: 'env-id' });
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('is for https://other.example, not this Studio')
    );
    // The other Studio's app is kept.
    const saved = await readSavedProject();
    expect(saved.hosts['https://other.example'].appId).toBe('other-app-id');
    expect(saved.hosts[options.host].appId).toBe('app-id');
  });

  it('takes an app saved without a host as one for Modelence Cloud', async () => {
    await saveProject('cloud-app-id', null);
    vi.mocked(isCI).mockReturnValue(true);
    await deploy({ host: 'https://cloud.modelence.com', env: 'prod' });
    expect(authenticateCli).not.toHaveBeenCalled();
    const [, , args] = request.mock.calls.find(([, path]) => path === '/api/upload-bundle')!;
    expect(args?.body).toMatchObject({ appId: 'cloud-app-id', envAlias: 'prod' });
  });
});

describe('status polling', () => {
  it('waits for provisioning before allowing an upload', async () => {
    vi.useFakeTimers();
    request
      .mockResolvedValueOnce({ status: 'provisioning' })
      .mockResolvedValueOnce({ status: 'ready' });
    const waiting = waitForEnvironmentReady(options.host, 'token', 'env-id');
    await vi.advanceTimersByTimeAsync(3000);
    await waiting;
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('preserves the log cursor when a poll temporarily returns no logs', async () => {
    vi.useFakeTimers();
    request
      .mockResolvedValueOnce({
        ...completed,
        status: 'building',
        logs: ['a', 'b'],
        logCursor: 'f/2',
      })
      .mockResolvedValueOnce({ ...completed, status: 'building', logCursor: null })
      .mockResolvedValueOnce(completed);
    const following = followDeploy(
      { host: options.host, token: 'token' },
      vi.fn(),
      'env-id',
      'build-id'
    );
    await vi.advanceTimersByTimeAsync(6000);
    await following;
    expect(request.mock.calls.map(([, , args]) => args?.query?.logCursor)).toEqual([
      undefined,
      'f/2',
      'f/2',
    ]);
  });
});
