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

describe('authenticateCli declared variables', () => {
  const env = { DATABASE_URL: { type: 'secret' as const } };
  const authRequest = () =>
    vi.mocked(fetch).mock.calls.find(([url]) => String(url).endsWith('/api/cli/auth'))?.[1];

  it('sends what modelence.config.json declares to the deploy picker', async () => {
    tokenResponses.push(() => Response.json({ token: 'tok' }));
    await authenticateCli(host, { pick: 'deploy', purpose: 'deploy', env });
    expect(JSON.parse(String(authRequest()?.body))).toEqual({ env });
  });

  // No picker, no variables step to fill.
  it('sends nothing when the page only authorizes', async () => {
    tokenResponses.push(() => Response.json({ token: 'tok' }));
    await authenticateCli(host, { purpose: 'deploy', env });
    expect(authRequest()?.body).toBeUndefined();
  });
});

describe('authenticateCli deploy target hint', () => {
  it('passes the named target for the picker to preselect', async () => {
    const open = (await import('open')).default;
    tokenResponses.push(() => Response.json({ token: 'tok' }));
    await authenticateCli(host, {
      pick: 'deploy',
      purpose: 'deploy',
      hint: { appAlias: 'app', envAlias: 'prod' },
    });
    const url = new URL(String(vi.mocked(open).mock.calls.at(-1)?.[0]));
    expect(url.searchParams.get('appAlias')).toBe('app');
    expect(url.searchParams.get('envAlias')).toBe('prod');
    expect(url.searchParams.get('pick')).toBe('deploy');
  });
});

describe('authenticateCli setup picker', () => {
  const openedUrl = async () => {
    const open = (await import('open')).default;
    return new URL(String(vi.mocked(open).mock.calls.at(-1)?.[0]));
  };

  it('asks the picker for a new environment only with createOnly', async () => {
    tokenResponses.push(() => Response.json({ token: 'tok' }));
    await authenticateCli(host, { pickEnvironment: true, createOnly: true, appId: 'a1' });
    const url = await openedUrl();
    expect(url.searchParams.get('pick')).toBe('environment');
    expect(url.searchParams.get('new')).toBe('1');
    expect(url.searchParams.get('appId')).toBe('a1');
  });

  it('lets the picker offer existing environments by default', async () => {
    tokenResponses.push(() => Response.json({ token: 'tok' }));
    await authenticateCli(host, { pickEnvironment: true });
    expect((await openedUrl()).searchParams.has('new')).toBe(false);
  });

  // Only the setup picker creates; a deploy target is always the user's choice.
  it('ignores createOnly outside the setup picker', async () => {
    tokenResponses.push(() => Response.json({ token: 'tok' }));
    await authenticateCli(host, { pick: 'deploy', purpose: 'deploy', createOnly: true });
    expect((await openedUrl()).searchParams.has('new')).toBe(false);
  });
});
