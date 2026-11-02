import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import express from 'express';
import http from 'http';
import type { AddressInfo } from 'net';

const mockGetSecurityConfig = vi.fn();
const mockGetConfig = vi.fn();

vi.doMock('./securityConfig', () => ({
  getSecurityConfig: mockGetSecurityConfig,
}));

vi.doMock('@/config/server', () => ({
  getConfig: mockGetConfig,
}));

const { crossOriginProtection, requireJsonBody } = await import('./requestGuards');

type TestResponse = { status: number; errorCode: string | undefined };

// Real Express on an ephemeral port, so the guards see genuine header parsing
// and `req.is` content negotiation rather than hand-built request objects.
let server: http.Server;
let port: number;

async function startApp(guards: express.RequestHandler[]) {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.all('/guarded', ...guards, (_req, res) => {
    res.status(200).send('ok');
  });
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
}

function send(
  options: { method?: string; headers?: Record<string, string>; body?: string } = {}
): Promise<TestResponse> {
  const { method = 'POST', headers = {}, body } = options;
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: '/guarded', method, headers },
      (res) => {
        res.resume();
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            errorCode: res.headers['x-modelence-error-code'] as string | undefined,
          })
        );
      }
    );
    req.on('error', reject);
    if (body !== undefined) {
      req.write(body);
    }
    req.end();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSecurityConfig.mockReturnValue({});
  mockGetConfig.mockReturnValue(undefined);
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('requireJsonBody', () => {
  beforeEach(async () => {
    await startApp([requireJsonBody()]);
  });

  test('accepts application/json', async () => {
    const res = await send({
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ args: {} }),
    });
    expect(res.status).toBe(200);
  });

  test('accepts application/json with a charset parameter', async () => {
    const res = await send({
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ args: {} }),
    });
    expect(res.status).toBe(200);
  });

  // Every content type an HTML form can produce, plus the body-less request a
  // no-cors fetch can send. None of them trigger a CORS preflight.
  test.each([
    ['application/x-www-form-urlencoded', 'args[userId]=victim'],
    [
      'multipart/form-data; boundary=x',
      '--x\r\nContent-Disposition: form-data; name="a"\r\n\r\nb\r\n--x--',
    ],
    ['text/plain', '{"args":{}}'],
  ])('rejects %s with 415', async (contentType, body) => {
    const res = await send({ headers: { 'content-type': contentType }, body });
    expect(res).toEqual({ status: 415, errorCode: 'UNSUPPORTED_CONTENT_TYPE' });
  });

  test('rejects a request without a body', async () => {
    const res = await send();
    expect(res).toEqual({ status: 415, errorCode: 'UNSUPPORTED_CONTENT_TYPE' });
  });
});

describe('crossOriginProtection', () => {
  async function start(securityConfig: { allowedOrigins?: string[] } = {}) {
    mockGetSecurityConfig.mockReturnValue(securityConfig);
    await startApp([crossOriginProtection()]);
  }

  test('lets safe methods through regardless of origin', async () => {
    await start();
    const res = await send({
      method: 'GET',
      headers: { origin: 'https://attacker.example.com', 'sec-fetch-site': 'same-site' },
    });
    expect(res.status).toBe(200);
  });

  test('lets non-browser requests through (no Origin, no Sec-Fetch-Site)', async () => {
    await start();
    const res = await send();
    expect(res.status).toBe(200);
  });

  describe('with Sec-Fetch-Site', () => {
    test.each(['same-origin', 'none'])('allows %s', async (site) => {
      await start();
      const res = await send({ headers: { 'sec-fetch-site': site } });
      expect(res.status).toBe(200);
    });

    test.each(['same-site', 'cross-site'])('blocks %s from an unlisted origin', async (site) => {
      await start();
      const res = await send({
        headers: { 'sec-fetch-site': site, origin: 'https://attacker.example.com' },
      });
      expect(res).toEqual({ status: 403, errorCode: 'CROSS_ORIGIN_REQUEST_BLOCKED' });
    });

    test('blocks a same-site request that omits Origin', async () => {
      await start();
      const res = await send({ headers: { 'sec-fetch-site': 'same-site' } });
      expect(res.status).toBe(403);
    });

    test('does not trust a matching Host when the browser says same-site', async () => {
      // Sec-Fetch-Site is set by the browser; a sibling subdomain cannot make it
      // claim same-origin, so the host fallback must not override it.
      await start();
      const res = await send({
        headers: {
          'sec-fetch-site': 'same-site',
          origin: `http://127.0.0.1:${port}`,
        },
      });
      expect(res.status).toBe(403);
    });

    test('allows an origin listed in security.allowedOrigins', async () => {
      await start({ allowedOrigins: ['http://localhost:8081'] });
      const res = await send({
        headers: { 'sec-fetch-site': 'same-site', origin: 'http://localhost:8081' },
      });
      expect(res.status).toBe(200);
    });

    test('allows the configured site URL origin', async () => {
      mockGetConfig.mockImplementation((key: string) =>
        key === '_system.site.url' ? 'https://app.example.com/' : undefined
      );
      await start();
      const res = await send({
        headers: { 'sec-fetch-site': 'cross-site', origin: 'https://app.example.com' },
      });
      expect(res.status).toBe(200);
    });

    test('ignores an unparseable site URL', async () => {
      mockGetConfig.mockReturnValue('not a url');
      await start();
      const res = await send({
        headers: { 'sec-fetch-site': 'cross-site', origin: 'https://attacker.example.com' },
      });
      expect(res.status).toBe(403);
    });
  });

  describe('without Sec-Fetch-Site (older browsers, plain HTTP)', () => {
    test('allows an Origin matching the Host header', async () => {
      await start();
      const res = await send({ headers: { origin: `http://127.0.0.1:${port}` } });
      expect(res.status).toBe(200);
    });

    test('ignores the scheme, since TLS is often terminated at a proxy', async () => {
      await start();
      const res = await send({
        headers: { origin: 'https://app.example.com', host: 'app.example.com' },
      });
      expect(res.status).toBe(200);
    });

    test('matches a Host that spells out the default port', async () => {
      await start();
      const res = await send({
        headers: { origin: 'https://app.example.com', host: 'app.example.com:443' },
      });
      expect(res.status).toBe(200);
    });

    test('blocks the same hostname on a different port', async () => {
      await start();
      const res = await send({
        headers: { origin: 'https://app.example.com:8443', host: 'app.example.com' },
      });
      expect(res.status).toBe(403);
    });

    test('allows an Origin matching X-Forwarded-Host', async () => {
      await start();
      const res = await send({
        headers: {
          origin: 'https://app.example.com',
          'x-forwarded-host': 'app.example.com, internal:3000',
        },
      });
      expect(res.status).toBe(200);
    });

    test('blocks a sibling subdomain', async () => {
      await start();
      const res = await send({
        headers: { origin: 'https://attacker.example.com', host: 'app.example.com' },
      });
      expect(res).toEqual({ status: 403, errorCode: 'CROSS_ORIGIN_REQUEST_BLOCKED' });
    });

    test('blocks the opaque "null" origin', async () => {
      await start();
      const res = await send({ headers: { origin: 'null' } });
      expect(res.status).toBe(403);
    });

    test('allows an origin listed in security.allowedOrigins', async () => {
      await start({ allowedOrigins: ['http://localhost:8081'] });
      const res = await send({ headers: { origin: 'http://localhost:8081' } });
      expect(res.status).toBe(200);
    });
  });
});
