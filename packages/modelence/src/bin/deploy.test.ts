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
import { confirm, isInteractive } from './terminal';

vi.mock('./auth', () => ({ authenticateCli: vi.fn() }));
vi.mock('./build', () => ({ build: vi.fn() }));
vi.mock('./terminal', () => ({ isInteractive: vi.fn(), confirm: vi.fn() }));
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
  vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  vi.stubEnv('MODELENCE_TOKEN', 'original-token');
  vi.stubEnv('MODELENCE_HOME', join(dir, 'auth'));
  vi.mocked(authenticateCli).mockResolvedValue({ token: 'refreshed-token' });
  vi.mocked(isInteractive).mockReturnValue(true);
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

  it('reauthorizes once when the upload authorization is rejected', async () => {
    request.mockRejectedValueOnce(new StudioApiError('Expired', 401));
    await deploy(options);
    expect(authenticateCli).toHaveBeenCalledTimes(1);
    expect(request.mock.calls.filter(([, path]) => path === '/api/deploy')).toHaveLength(1);
    expect(request).toHaveBeenCalledWith(
      options.host,
      '/api/upload-bundle',
      expect.objectContaining({ token: 'refreshed-token' })
    );
  });

  it('resumes polling after authorization expires without starting another build', async () => {
    const original = request.getMockImplementation()!;
    let polls = 0;
    request.mockImplementation(async (host, path, args) => {
      if (path === '/api/deploy/status' && polls++ === 0) throw new StudioApiError('Expired', 401);
      return original(host, path, args);
    });
    await deploy(options);
    expect(authenticateCli).toHaveBeenCalledTimes(1);
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
});

async function saveTarget(appAlias: string, envAlias: string) {
  await mkdir(join(project, '.modelence'), { recursive: true });
  await writeFile(
    join(project, '.modelence/project.json'),
    JSON.stringify({ deploy: { environmentId: `${envAlias}-id`, appAlias, envAlias } })
  );
}

async function readSavedProject() {
  try {
    return JSON.parse(await readFile(join(project, '.modelence/project.json'), 'utf8'));
  } catch {
    return null;
  }
}

describe('without anyone at the terminal', () => {
  beforeEach(() => {
    vi.mocked(isInteractive).mockReturnValue(false);
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

  it('deploys to explicit flags without asking, even when another target is saved', async () => {
    await saveTarget('app', 'staging');
    await deploy(options);
    expect(confirm).not.toHaveBeenCalled();
    expect(upload).toHaveBeenCalledTimes(1);
  });
});

describe('deploy target', () => {
  it('does not make a target given by flags the default for later deploys', async () => {
    await saveTarget('app', 'staging');
    vi.mocked(confirm).mockResolvedValue(true);
    await deploy(options);
    expect((await readSavedProject()).deploy.envAlias).toBe('staging');
  });

  it('does not record a target given by flags when none is saved', async () => {
    await deploy(options);
    expect(await readSavedProject()).toBeNull();
  });

  it('records the target picked in the browser', async () => {
    vi.mocked(authenticateCli).mockResolvedValue({
      token: 'browser-token',
      target: { appId: 'app-id', appAlias: 'app', environmentId: 'env-id', envAlias: 'prod' },
    });
    await deploy({ host: options.host });
    expect(await readSavedProject()).toEqual({
      appId: 'app-id',
      deploy: { environmentId: 'env-id', appAlias: 'app', envAlias: 'prod' },
    });
  });

  it('names the saved target before building', async () => {
    await saveTarget('app', 'staging');
    await deploy({ host: options.host });
    expect(console.log).toHaveBeenCalledWith(
      'Deploying to app/staging (saved in .modelence/project.json)'
    );
    expect(confirm).not.toHaveBeenCalled();
  });

  it('asks before deploying to flags that differ from the saved target', async () => {
    await saveTarget('app', 'staging');
    vi.mocked(confirm).mockResolvedValue(false);
    await expect(deploy(options)).rejects.toThrow('Cancelled.');
    expect(confirm).toHaveBeenCalledWith(
      'This project normally deploys to app/staging. Deploy to app/prod instead?'
    );
    expect(request).not.toHaveBeenCalled();
  });

  it('skips the question with --yes', async () => {
    await saveTarget('app', 'staging');
    await deploy({ ...options, yes: true });
    expect(confirm).not.toHaveBeenCalled();
    expect(upload).toHaveBeenCalledTimes(1);
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
