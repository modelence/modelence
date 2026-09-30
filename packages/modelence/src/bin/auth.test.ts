import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authenticateCli } from './auth';

vi.mock('open', () => ({ default: vi.fn() }));

const host = 'https://studio.example';
let tokenResponses: Array<() => Response>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  tokenResponses = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.endsWith('/api/cli/auth')) {
        return Response.json({ code: 'c1', verificationUrl: `${host}/cli/auth/verify?code=c1` });
      }
      const next = tokenResponses.shift();
      if (!next) throw new Error('fetch failed');
      return next();
    })
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('authenticateCli polling', () => {
  it('stops at once when Studio rejects the code', async () => {
    tokenResponses.push(() => new Response('Error: Invalid or expired code', { status: 500 }));
    await expect(authenticateCli(host)).rejects.toThrow('The sign-in code has expired');
    tokenResponses.push(() => new Response('Not found', { status: 404 }));
    await expect(authenticateCli(host)).rejects.toThrow('The sign-in code has expired');
  });

  it('keeps polling through network errors, reporting them once', async () => {
    tokenResponses.push(
      () => Response.json({ status: 'pending' }),
      () => {
        throw new Error('offline');
      },
      () => {
        throw new Error('offline');
      },
      () => Response.json({ token: 'tok' })
    );
    const result = authenticateCli(host);
    await vi.advanceTimersByTimeAsync(6000);
    expect(await result).toEqual({ token: 'tok', expiresAt: undefined, target: undefined });
    expect(console.error).toHaveBeenCalledTimes(1);
  });
});
