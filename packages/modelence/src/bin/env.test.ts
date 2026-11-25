import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  envList,
  isOnHost,
  envPush,
  envRemove,
  envRequest,
  envSet,
  isSavedSince,
  type EnvVarSummary,
} from './env';
import { openEnvironment } from './environmentSession';
import { promptHidden, readStdin } from './secretInput';

vi.mock('open', () => ({ default: vi.fn(async () => {}) }));
vi.mock('./environmentSession', () => ({ openEnvironment: vi.fn() }));
vi.mock('./secretInput', () => ({ promptHidden: vi.fn(), readStdin: vi.fn() }));

const get = vi.fn();
const post = vi.fn();
const target = { app: 'shop', env: 'prod' };
let dir: string;
let printed: string;
const isTTY = process.stdin.isTTY;

const summary = (fields: Partial<EnvVarSummary>): EnvVarSummary => ({
  key: 'A',
  status: 'set',
  secret: false,
  scopes: ['runtime'],
  value: 'v',
  resource: null,
  declared: true,
  updatedAt: '2026-11-25T10:00:00.000Z',
  ...fields,
});

beforeEach(async () => {
  vi.resetAllMocks();
  vi.mocked(openEnvironment).mockResolvedValue({ host: 'https://h', get, post });
  post.mockResolvedValue({ saved: [], removed: [], restartNeeded: false });
  printed = '';
  const capture = (chunk: unknown) => {
    printed += String(chunk);
    return true;
  };
  vi.spyOn(process.stdout, 'write').mockImplementation(capture);
  vi.spyOn(process.stderr, 'write').mockImplementation(capture);
  dir = await mkdtemp(join(tmpdir(), 'modelence-env-'));
  vi.spyOn(process, 'cwd').mockReturnValue(dir);
  await writeFile(
    join(dir, 'modelence.config.json'),
    JSON.stringify({
      env: {
        STRIPE_KEY: { type: 'secret' },
        LOG_LEVEL: {},
        DATABASE_URL: { type: 'resource', resource: 'main-db', output: 'url' },
      },
    })
  );
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  process.stdin.isTTY = isTTY;
  await rm(dir, { recursive: true, force: true });
});

const sent = () => post.mock.calls[0][1].variables;

describe('env list', () => {
  it('prints plain values and hides secrets', async () => {
    get.mockResolvedValue({
      variables: [
        summary({ key: 'LOG_LEVEL', value: 'debug' }),
        summary({ key: 'STRIPE_KEY', secret: true, value: null }),
        summary({ key: 'DATABASE_URL', status: 'resource', resource: 'main-db.url', value: null }),
        summary({ key: 'TODO', status: 'missing', value: null }),
      ],
      restartNeeded: true,
    });
    await envList(target);
    expect(printed).toMatch(/LOG_LEVEL\s+set\s+runtime\s+debug/);
    expect(printed).toMatch(/STRIPE_KEY\s+set\s+runtime\s+\(secret\)/);
    expect(printed).toMatch(/DATABASE_URL\s+resource\s+runtime\s+from main-db.url/);
    expect(printed).toMatch(/TODO\s+not set/);
    expect(printed).toContain('npx modelence@latest restart --app shop --env prod');
  });
});

describe('env set', () => {
  it('marks values given as arguments, so Studio can refuse them for a secret', async () => {
    await envSet(['LOG_LEVEL=a=b', 'NEW='], { ...target, text: true });
    expect(sent()).toEqual([
      {
        key: 'LOG_LEVEL',
        value: 'a=b',
        plainOnly: true,
        requested: { secret: false },
        declaration: { type: undefined, scopes: undefined },
      },
      { key: 'NEW', value: '', plainOnly: true, requested: { secret: false } },
    ]);
  });

  it('never prints a value it was given', async () => {
    post.mockResolvedValue({
      saved: [{ key: 'STRIPE_KEY', secret: true, scopes: ['runtime'] }],
      restartNeeded: true,
    });
    vi.mocked(readStdin).mockResolvedValue('hunter22');
    await envSet(['STRIPE_KEY'], { ...target, stdin: true });
    expect(sent()).toMatchObject([
      { key: 'STRIPE_KEY', value: 'hunter22', declaration: { type: 'secret' } },
    ]);
    expect(sent()[0]).not.toHaveProperty('plainOnly');
    expect(printed).toContain('Set STRIPE_KEY (secret, runtime)');
    expect(printed).not.toContain('hunter22');
  });

  it('asks in a terminal and points elsewhere without one', async () => {
    process.stdin.isTTY = true;
    vi.mocked(promptHidden).mockResolvedValue('typed');
    await envSet(['STRIPE_KEY'], target);
    expect(sent()).toMatchObject([{ key: 'STRIPE_KEY', value: 'typed' }]);

    process.stdin.isTTY = false;
    await expect(envSet(['STRIPE_KEY'], target)).rejects.toThrow('env request STRIPE_KEY');
  });

  it.each([
    [['A=1'], { secret: true }, "A secret can't be given as NAME=value"],
    [['A=1'], { stdin: true }, 'pass only the name'],
    [['A', 'B'], {}, 'one name at a time'],
    [['A', 'B=1'], {}, 'one name at a time'],
    [['A=1'], { text: true, secret: true }, 'not both'],
    [['A=1'], { scopes: 'build,deploy' }, 'not "deploy"'],
  ])('refuses %j with %j', async (entries, flags, message) => {
    await expect(envSet(entries, { ...target, ...flags })).rejects.toThrow(message);
    expect(openEnvironment).not.toHaveBeenCalled();
  });

  it('refuses a name a resource supplies, and an empty piped value', async () => {
    await expect(envSet(['DATABASE_URL=x'], target)).rejects.toThrow('resource "main-db"');
    vi.mocked(readStdin).mockResolvedValue('');
    await expect(envSet(['A'], { ...target, stdin: true })).rejects.toThrow('No value given');
    expect(post).not.toHaveBeenCalled();
  });
});

describe('env push', () => {
  it('sends the declared variables of the file without printing any value', async () => {
    await writeFile(join(dir, '.env.prod'), 'STRIPE_KEY=hunter22\nDEBUG=hunter33\nPORT=1\n');
    await envPush({ ...target, file: '.env.prod' });
    expect(sent()).toMatchObject([{ key: 'STRIPE_KEY', value: 'hunter22' }]);
    expect(printed).toContain('Skipped DEBUG: not declared');
    expect(printed).not.toContain('hunter');
  });

  it('refuses a missing file, a file with nothing to send, and a project without a config', async () => {
    await expect(envPush({ ...target, file: 'nope' })).rejects.toThrow(
      'Could not read nope (ENOENT)'
    );
    await writeFile(join(dir, '.env'), 'DEBUG=1\n');
    await expect(envPush({ ...target, file: '.env' })).rejects.toThrow('Nothing to push');
    await rm(join(dir, 'modelence.config.json'));
    await expect(envPush({ ...target, file: '.env' })).rejects.toThrow('Pass --all');
    expect(post).not.toHaveBeenCalled();
  });
});

describe('env remove', () => {
  it('removes by name', async () => {
    post.mockResolvedValue({ removed: ['A', 'B'], restartNeeded: false });
    await envRemove(['A', 'B'], target);
    expect(post).toHaveBeenCalledWith('/api/cli/env/remove', { keys: ['A', 'B'] });
    expect(printed).toContain('Removed A, B');
  });
});

describe('env request', () => {
  beforeEach(() => {
    post.mockResolvedValue({ url: 'https://h/config?request=TODO' });
  });

  it('asks for what is missing by default and can leave it at the link', async () => {
    get.mockResolvedValue({
      variables: [summary({}), summary({ key: 'TODO', status: 'missing', updatedAt: null })],
    });
    await envRequest([], { ...target, wait: false });
    expect(post).toHaveBeenCalledWith('/api/cli/env/request', { keys: ['TODO'] });
    expect(printed).toContain('Enter TODO at https://h/config?request=TODO');
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('waits until every value is saved, reporting names only', async () => {
    vi.useFakeTimers();
    const missing = summary({ key: 'TODO', status: 'missing', value: null, updatedAt: null });
    get
      .mockResolvedValueOnce({ variables: [missing] })
      .mockResolvedValueOnce({ variables: [missing] })
      .mockResolvedValueOnce({
        variables: [summary({ key: 'TODO', value: 'hunter22' })],
        restartNeeded: true,
      });
    const done = envRequest(['TODO'], { ...target, wait: true });
    await vi.advanceTimersByTimeAsync(6000);
    await done;
    expect(printed).toContain('TODO: set');
    expect(printed).toContain('restart --app shop');
    expect(printed).not.toContain('hunter22');
  });

  it('does nothing when nothing is missing', async () => {
    get.mockResolvedValue({ variables: [summary({})] });
    await envRequest([], { ...target, wait: true });
    expect(post).not.toHaveBeenCalled();
  });

  it('only opens pages of the Studio in use', () => {
    expect(isOnHost('https://h/config', 'https://h')).toBe(true);
    for (const url of ['https://evil/config', 'http://h/config', 'file:///etc/passwd', 'nope']) {
      expect(isOnHost(url, 'https://h')).toBe(false);
    }
  });

  it('only counts a value saved after the request', () => {
    const before = [summary({})];
    expect(isSavedSince('A', before, [summary({})])).toBe(false);
    expect(isSavedSince('A', before, [summary({ updatedAt: '2026-11-25T11:00:00.000Z' })])).toBe(
      true
    );
    expect(isSavedSince('A', [], [summary({})])).toBe(true);
  });
});
