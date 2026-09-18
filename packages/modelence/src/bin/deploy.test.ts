import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { access, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { deploy } from './deploy';
import { authenticateCli } from './auth';
import { StudioApiError, studioRequest } from './studioApi';
import { followDeploy, waitForEnvironmentReady } from './deployStatus';

vi.mock('./auth', () => ({ authenticateCli: vi.fn() }));
vi.mock('./build', () => ({ build: vi.fn() }));
vi.mock('./config', () => ({ loadEnv: vi.fn(), getProjectPath: vi.fn() }));
vi.mock('./studioApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./studioApi')>()),
  studioRequest: vi.fn(),
}));

const request = vi.mocked(studioRequest);
const options = { host: 'https://studio.example', app: 'app', env: 'prod' };
const completed = {
  status: 'deploy-completed',
  logs: [],
  logCount: 0,
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
  await writeFile(
    join(project, 'package.json'),
    JSON.stringify({ scripts: { start: 'node server.js' } })
  );
  vi.spyOn(process, 'cwd').mockReturnValue(project);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  vi.stubEnv('MODELENCE_TOKEN', 'original-token');
  vi.stubEnv('MODELENCE_HOME', join(dir, 'auth'));
  vi.mocked(authenticateCli).mockResolvedValue({ token: 'refreshed-token' });
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
        query: { environmentId: 'env-id', buildId: 'build-id', logOffset: 0 },
      })
    );
    await expect(access(join(project, '.modelence/tmp/source.zip'))).rejects.toThrow();
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
      .mockResolvedValueOnce({ ...completed, status: 'building', logs: ['a', 'b'], logCount: 2 })
      .mockResolvedValueOnce({ ...completed, status: 'building', logCount: 0 })
      .mockResolvedValueOnce(completed);
    const following = followDeploy(
      { host: options.host, token: 'token' },
      vi.fn(),
      'env-id',
      'build-id'
    );
    await vi.advanceTimersByTimeAsync(6000);
    await following;
    expect(request.mock.calls.map(([, , args]) => args?.query?.logOffset)).toEqual([0, 2, 2]);
  });
});
