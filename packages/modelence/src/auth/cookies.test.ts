import { afterEach, describe, expect, test, vi } from 'vitest';
import express, { type Response } from 'express';
import http from 'http';
import type { AddressInfo } from 'net';
import {
  clearAuthCookie,
  getAuthCookieName,
  getAuthTokenFromCookies,
  readAuthCookie,
  setAuthCookie,
} from './cookies';
import { clearAuthTokenCookie } from './session';

// Runs `write` inside a real Express response and returns the Set-Cookie
// headers it produced, so assertions cover the exact attributes a browser sees.
async function captureSetCookie(write: (res: Response) => void): Promise<string[]> {
  const app = express();
  app.get('/', (_req, res) => {
    write(res);
    res.end();
  });
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address() as AddressInfo;
    return await new Promise((resolve, reject) => {
      http
        .get({ host: '127.0.0.1', port, path: '/' }, (res) => {
          res.resume();
          res.on('end', () => resolve(res.headers['set-cookie'] ?? []));
        })
        .on('error', reject);
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('auth/cookies in production', () => {
  test('prefixes every auth cookie with __Host-', () => {
    vi.stubEnv('NODE_ENV', 'production');

    expect(getAuthCookieName('authToken')).toBe('__Host-authToken');
    expect(getAuthCookieName('oauthLinkToken')).toBe('__Host-oauthLinkToken');
    expect(getAuthCookieName('magicLinkToken')).toBe('__Host-magicLinkToken');
    expect(getAuthCookieName('resetPasswordToken')).toBe('__Host-resetPasswordToken');
    expect(getAuthCookieName('authStateGoogle')).toBe('__Host-authStateGoogle');
    expect(getAuthCookieName('authStateGithub')).toBe('__Host-authStateGithub');
  });

  test('sets the attributes browsers require for __Host- (Secure, Path=/, no Domain)', async () => {
    vi.stubEnv('NODE_ENV', 'production');

    const [header] = await captureSetCookie((res) => setAuthCookie(res, 'authToken', 'tok', 1000));

    expect(header).toMatch(/^__Host-authToken=tok;/);
    expect(header).toContain('Path=/;');
    expect(header).toContain('Secure');
    expect(header).toContain('HttpOnly');
    expect(header).toContain('SameSite=Lax');
    expect(header).toContain('Max-Age=1');
    expect(header).not.toMatch(/Domain=/i);
  });

  test('clears with an expiry in the past rather than re-setting the cookie', async () => {
    vi.stubEnv('NODE_ENV', 'production');

    const [header] = await captureSetCookie((res) => clearAuthCookie(res, 'magicLinkToken'));

    expect(header).toMatch(/^__Host-magicLinkToken=;/);
    expect(header).toContain('Path=/;');
    expect(header).toContain('Expires=Thu, 01 Jan 1970');
    expect(header).not.toContain('Max-Age');
  });

  test('ignores an unprefixed cookie a sibling subdomain could have planted', () => {
    vi.stubEnv('NODE_ENV', 'production');

    const req = { cookies: { authToken: 'attacker-token' } };

    expect(readAuthCookie(req, 'authToken')).toBeUndefined();
    expect(getAuthTokenFromCookies(req.cookies)).toBeUndefined();
  });

  test('reads the prefixed cookie', () => {
    vi.stubEnv('NODE_ENV', 'production');

    const cookies = { authToken: 'attacker-token', '__Host-authToken': 'real-token' };

    expect(readAuthCookie({ cookies }, 'authToken')).toBe('real-token');
    expect(getAuthTokenFromCookies(cookies)).toBe('real-token');
  });

  test('logout also clears the unprefixed cookie older versions set', async () => {
    vi.stubEnv('NODE_ENV', 'production');

    const headers = await captureSetCookie((res) => clearAuthTokenCookie(res));

    expect(headers).toHaveLength(2);
    expect(headers[0]).toMatch(/^__Host-authToken=;/);
    expect(headers[1]).toMatch(/^authToken=;/);
    expect(headers[1]).toContain('Path=/;');
  });
});

describe('auth/cookies outside production', () => {
  test('keeps the bare name, since __Host- needs Secure and Safari rejects it on localhost', () => {
    vi.stubEnv('NODE_ENV', 'development');

    expect(getAuthCookieName('authToken')).toBe('authToken');
  });

  test('sets a non-Secure cookie with Path=/', async () => {
    vi.stubEnv('NODE_ENV', 'development');

    const [header] = await captureSetCookie((res) =>
      setAuthCookie(res, 'resetPasswordToken', 'tok', 1000)
    );

    expect(header).toMatch(/^resetPasswordToken=tok;/);
    expect(header).toContain('Path=/;');
    expect(header).not.toContain('Secure');
  });

  test('logout clears the cookie only once', async () => {
    vi.stubEnv('NODE_ENV', 'development');

    const headers = await captureSetCookie((res) => clearAuthTokenCookie(res));

    expect(headers).toHaveLength(1);
    expect(headers[0]).toMatch(/^authToken=;/);
  });

  test('reads the bare cookie', () => {
    vi.stubEnv('NODE_ENV', 'development');

    expect(readAuthCookie({ cookies: { authToken: 'tok' } }, 'authToken')).toBe('tok');
  });
});

describe('auth/cookies reading', () => {
  test.each([null, undefined, { cookies: undefined }])('returns undefined for %o', (req) => {
    expect(readAuthCookie(req as never, 'authToken')).toBeUndefined();
  });

  test('ignores non-string values (e.g. JSON cookies parsed into objects)', () => {
    vi.stubEnv('NODE_ENV', 'development');

    expect(
      readAuthCookie({ cookies: { authToken: { a: 1 } } } as never, 'authToken')
    ).toBeUndefined();
  });
});
