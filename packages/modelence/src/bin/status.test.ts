import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildLogs, listBuilds, type BuildSummary } from './builds';
import { openEnvironment } from './environmentSession';
import { formatStatus, restart, status, type EnvironmentStatus } from './status';

vi.mock('./environmentSession', () => ({ openEnvironment: vi.fn() }));

const get = vi.fn();
const post = vi.fn();
const target = { app: 'shop', env: 'prod' };
let printed: string;

const build = (fields: Partial<BuildSummary> = {}): BuildSummary => ({
  id: 'b1',
  number: 12,
  status: 'deploy-completed',
  isCurrent: true,
  source: 'source',
  appVersion: '1.2.0',
  commitSha: 'abcdef1234',
  createdAt: '2026-11-25T10:00:00.000Z',
  finishedAt: null,
  errors: [],
  ...fields,
});

const healthy: EnvironmentStatus = {
  app: { id: 'a1', alias: 'shop' },
  environment: { id: 'e1', alias: 'prod', type: 'cloud', status: 'ready', errors: [] },
  isStopped: false,
  siteUrl: 'https://shop.example',
  dashboardUrl: 'https://h/environments/e1',
  configUrl: 'https://h/environments/e1/config',
  services: [{ name: 'web', desiredCount: 2, runningCount: 2, lastCrash: null }],
  currentBuild: build(),
  latestBuild: build(),
  missingEnvVars: [],
  restartNeeded: false,
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(openEnvironment).mockResolvedValue({ host: 'https://h', get, post });
  printed = '';
  const capture = (chunk: unknown) => {
    printed += String(chunk);
    return true;
  };
  vi.spyOn(process.stdout, 'write').mockImplementation(capture);
  vi.spyOn(process.stderr, 'write').mockImplementation(capture);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('status', () => {
  it('is short for a healthy environment', () => {
    expect(formatStatus(healthy)).toEqual([
      'shop / prod (cloud, ready)',
      'URL: https://shop.example',
      'Dashboard: https://h/environments/e1',
      'Services:',
      '  web: 2 of 2 running',
      'Running build: #12 deploy-completed (1.2.0 abcdef1), 2026-11-25T10:00:00.000Z',
    ]);
  });

  it('shows what needs attention', () => {
    const lines = formatStatus({
      ...healthy,
      services: [
        {
          name: 'web',
          desiredCount: 2,
          runningCount: 0,
          lastCrash: { stoppedAt: null, exitCode: 1, reason: 'Essential container exited' },
        },
      ],
      latestBuild: build({ id: 'b2', number: 13, status: 'deploy-failed', errors: ['boom'] }),
      missingEnvVars: ['STRIPE_KEY'],
      restartNeeded: true,
    }).join('\n');
    expect(lines).toContain('0 of 2 running; last crash: exit code 1, Essential container exited');
    expect(lines).toContain('Latest build: #13 deploy-failed');
    expect(lines).toContain('  boom');
    expect(lines).toContain('Variables without a value: STRIPE_KEY');
    expect(lines).toContain('Restart needed');
  });

  it('prints JSON for agents', async () => {
    get.mockResolvedValue(healthy);
    await status({ ...target, json: true });
    expect(JSON.parse(printed)).toEqual(healthy);
  });
});

describe('restart', () => {
  it('asks Studio to restart', async () => {
    await restart(target);
    expect(post).toHaveBeenCalledWith('/api/cli/restart');
  });
});

describe('builds', () => {
  it('lists builds, marking the running one', async () => {
    get.mockResolvedValue({
      builds: [build(), build({ number: null, isCurrent: false })],
      total: 2,
    });
    await listBuilds({ ...target, limit: '5' });
    expect(get).toHaveBeenCalledWith('/api/cli/builds', { limit: 5 });
    expect(printed).toMatch(/#12\s+deploy-completed.*running/);
  });

  it('shows one build log with why it failed', async () => {
    get.mockResolvedValue({
      build: build({ errors: ['Tasks failed'] }),
      lines: ['npm ci\n'],
      truncated: true,
      containerLogs: ['crash'],
    });
    await buildLogs('#12', target);
    expect(get).toHaveBeenCalledWith('/api/cli/builds/logs', { build: '12' });
    for (const text of ['npm ci', 'Error: Tasks failed', 'Container output:', 'crash', '--lines']) {
      expect(printed).toContain(text);
    }
  });
});
