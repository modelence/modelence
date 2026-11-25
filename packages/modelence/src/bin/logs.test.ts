import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openEnvironment } from './environmentSession';
import { logs, nextSince, parseSince, selectNewLines, type LogLine } from './logs';
import { StudioApiError } from './studioApi';

vi.mock('./environmentSession', () => ({ openEnvironment: vi.fn() }));

const get = vi.fn();
const target = { app: 'shop', env: 'prod' };
let printed: string[];
let noted: string[];

const line = (second: number, message: string): LogLine => ({
  timestamp: new Date(Date.UTC(2026, 10, 25, 10, 0, second)).toISOString(),
  service: 'web',
  containerId: 'c1',
  message,
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(openEnvironment).mockResolvedValue({ host: 'https://h', get, post: vi.fn() });
  printed = [];
  noted = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) =>
    Boolean(printed.push(`${chunk}`))
  );
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => Boolean(noted.push(`${chunk}`)));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('parseSince', () => {
  const now = new Date('2026-11-25T10:00:00.000Z');
  it.each([
    ['10m', '2026-11-25T09:50:00.000Z'],
    ['2h', '2026-11-25T08:00:00.000Z'],
    ['2026-11-24T00:00:00Z', '2026-11-24T00:00:00.000Z'],
  ])('reads %s', (value, expected) => {
    expect(parseSince(value, now)).toBe(expected);
  });

  it('refuses anything else', () => {
    expect(() => parseSince('a while', now)).toThrow('--since takes');
  });
});

describe('logs', () => {
  it('asks for what the flags say and prints one line each', async () => {
    get.mockResolvedValue({ lines: [line(1, 'hello\n')], unreadServices: [] });
    await logs({ ...target, service: 'web', lines: '50' });
    expect(get).toHaveBeenCalledWith('/api/cli/logs', { service: 'web', limit: 50 });
    expect(printed).toEqual(['2026-11-25T10:00:01.000Z web/c1 hello\n']);
  });

  it('prints JSON lines', async () => {
    get.mockResolvedValue({ lines: [line(1, 'a'), line(2, 'b')], unreadServices: [] });
    await logs({ ...target, json: true });
    expect(printed.map((text) => JSON.parse(text).message)).toEqual(['a', 'b']);
  });

  it('refuses a bad count before signing in', async () => {
    await expect(logs({ ...target, lines: 'x' })).rejects.toThrow('--lines must be');
    expect(openEnvironment).not.toHaveBeenCalled();
  });

  it('follows, printing each line once and riding out a busy Studio', async () => {
    vi.useFakeTimers();
    get
      .mockResolvedValueOnce({ lines: [line(1, 'a')], unreadServices: [] })
      .mockRejectedValueOnce(new StudioApiError('busy', 503))
      // b was written with a but reached the log after it.
      .mockResolvedValueOnce({
        lines: [line(1, 'b'), line(1, 'a'), line(2, 'c')],
        unreadServices: [],
      })
      .mockRejectedValueOnce(new StudioApiError('no access', 400));
    const following = logs({ ...target, follow: true }).catch((error: Error) => error);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(String(await following)).toContain('no access');
    expect(printed.map((text) => text.trim().split(' ').at(-1))).toEqual(['a', 'b', 'c']);
    expect(noted.join('')).toContain('retrying');
    expect(get.mock.calls[2][1].since).toBe('2026-11-25T10:00:01.000Z');
  });
});

describe('nextSince', () => {
  it('reads back a little, but not past what was shown first', () => {
    const newest = line(40, '').timestamp;
    expect(nextSince(newest, line(0, '').timestamp)).toBe(line(25, '').timestamp);
    expect(nextSince(newest, line(38, '').timestamp)).toBe(line(38, '').timestamp);
  });

  it('never relies on the local clock', () => {
    expect(nextSince(undefined, undefined)).toBeUndefined();
    expect(nextSince(undefined, '2026-11-25T09:00:00.000Z')).toBe('2026-11-25T09:00:00.000Z');
  });
});

it('says which services could not be read', async () => {
  get.mockResolvedValue({ lines: [line(1, 'a')], unreadServices: ['worker'] });
  await logs(target);
  expect(printed).toHaveLength(1);
  expect(noted.join('')).toContain('worker');
});

describe('selectNewLines', () => {
  it('keeps repeats of the same line apart', () => {
    const { counts } = selectNewLines([line(1, 'tick')], new Map());
    const next = selectNewLines([line(1, 'tick'), line(1, 'tick')], counts);
    expect(next.lines).toHaveLength(1);
  });
});
