import { createHash } from 'crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authenticateCli } from './auth';

vi.mock('open', () => ({ default: vi.fn() }));

const host = 'https://studio.example';
let tokenResponses: Array<() => Response>;
let codeChallengeAccepted: boolean | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  tokenResponses = [];
  codeChallengeAccepted = true;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.endsWith('/api/cli/auth')) {
        return Response.json({
          code: 'c1',
          verificationUrl: `${host}/cli/auth/verify?code=c1`,
          codeChallengeAccepted,
        });
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
    codeChallengeAccepted = undefined;
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

describe('authenticateCli token pickup', () => {
  const calls = () =>
    vi.mocked(fetch).mock.calls.map(([url, init]) => ({ url: String(url), init }));
  const authBody = () =>
    JSON.parse(String(calls().find(({ url }) => url.endsWith('/api/cli/auth'))?.init?.body));
  const pollRequest = () => calls().find(({ url }) => url.includes('/api/cli/token'));

  it('proves it started the sign-in, without the secret leaving the request body', async () => {
    tokenResponses.push(() => Response.json({ token: 'tok' }));
    await authenticateCli(host);

    const { codeChallenge } = authBody();
    expect(codeChallenge).toMatch(/^[\w-]{43}$/);

    const poll = pollRequest();
    expect(poll?.url).toBe(`${host}/api/cli/token`);
    expect(poll?.init?.method).toBe('POST');
    const { code, codeVerifier } = JSON.parse(String(poll?.init?.body));
    expect(code).toBe('c1');
    expect(createHash('sha256').update(codeVerifier).digest('base64url')).toBe(codeChallenge);
  });

  it('never prints the secret', async () => {
    tokenResponses.push(() => Response.json({ token: 'tok' }));
    await authenticateCli(host);
    const { codeVerifier } = JSON.parse(String(pollRequest()?.init?.body));
    const printed = JSON.stringify([
      vi.mocked(console.log).mock.calls,
      vi.mocked(console.error).mock.calls,
    ]);
    expect(printed).not.toContain(codeVerifier);
  });

  it('uses a fresh secret for each sign-in', async () => {
    tokenResponses.push(
      () => Response.json({ token: 'tok' }),
      () => Response.json({ token: 'tok' })
    );
    await authenticateCli(host);
    await authenticateCli(host);
    const challenges = calls()
      .filter(({ url }) => url.endsWith('/api/cli/auth'))
      .map(({ init }) => JSON.parse(String(init?.body)).codeChallenge);
    expect(new Set(challenges).size).toBe(2);
  });

  // A Studio that predates the challenge ignores it and only knows the GET route.
  it('falls back to polling by code when Studio did not accept the challenge', async () => {
    codeChallengeAccepted = undefined;
    tokenResponses.push(() => Response.json({ token: 'tok' }));
    await authenticateCli(host);
    expect(pollRequest()?.url).toBe(`${host}/api/cli/token?code=c1`);
    expect(pollRequest()?.init?.method).toBe('GET');
  });

  it('says why Studio refused the token, when it gives a reason', async () => {
    tokenResponses.push(() =>
      Response.json(
        { error: 'Only the terminal that started this sign-in can collect its token' },
        { status: 403 }
      )
    );
    await expect(authenticateCli(host)).rejects.toThrow(
      'Only the terminal that started this sign-in can collect its token. Please run the command again.'
    );
  });

  it('treats a token already collected as a dead code', async () => {
    tokenResponses.push(() => new Response('Gone', { status: 410 }));
    await expect(authenticateCli(host)).rejects.toThrow('The sign-in code has expired');
  });

  // During a rolling deploy, a poll can reach an instance without the POST route.
  it.each([404, 405])('keeps polling through a %i on the POST route', async (status) => {
    tokenResponses.push(
      () => new Response('Not found', { status }),
      () => Response.json({ token: 'tok' })
    );
    const result = authenticateCli(host);
    await vi.advanceTimersByTimeAsync(2000);
    expect((await result).token).toBe('tok');
  });

  it('keeps waiting through rate limiting', async () => {
    tokenResponses.push(
      () => new Response('Too many requests', { status: 429 }),
      () => Response.json({ token: 'tok' })
    );
    const result = authenticateCli(host);
    await vi.advanceTimersByTimeAsync(2000);
    expect((await result).token).toBe('tok');
  });
});

describe('authenticateCli code creation', () => {
  const failAuth = (response: Response) =>
    vi.mocked(fetch).mockImplementationOnce(async () => response);

  it("shows Studio's reason when it cannot create a code", async () => {
    failAuth(
      Response.json({ error: 'Too many requests. Try again in a few minutes.' }, { status: 429 })
    );
    await expect(authenticateCli(host)).rejects.toThrow(
      'Failed to create CLI authentication code: Too many requests. Try again in a few minutes.'
    );
  });

  it('falls back to the status when the body is not a Studio error', async () => {
    failAuth(new Response('<html>Bad gateway</html>', { status: 502, statusText: 'Bad Gateway' }));
    await expect(authenticateCli(host)).rejects.toThrow(
      'Failed to create CLI authentication code: 502 Bad Gateway'
    );
  });
});

describe('authenticateCli declared variables', () => {
  const env = { DATABASE_URL: { type: 'secret' as const } };
  const authRequest = () =>
    vi.mocked(fetch).mock.calls.find(([url]) => String(url).endsWith('/api/cli/auth'))?.[1];

  it('sends what modelence.config.json declares to the deploy picker', async () => {
    tokenResponses.push(() => Response.json({ token: 'tok' }));
    await authenticateCli(host, { pick: 'deploy', purpose: 'deploy', env });
    expect(JSON.parse(String(authRequest()?.body))).toMatchObject({ env });
  });

  // No picker, no variables step to fill.
  it('sends nothing when the page only authorizes', async () => {
    tokenResponses.push(() => Response.json({ token: 'tok' }));
    await authenticateCli(host, { purpose: 'deploy', env });
    expect(JSON.parse(String(authRequest()?.body)).env).toBeUndefined();
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
