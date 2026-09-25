import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { fetchRemoteEnv, mergeRuntimeEnv, type FetchPolicy } from './env';

describe('mergeRuntimeEnv', () => {
  it('lets the environment override the image except for the platform names', () => {
    const remote = {
      PORT: '8080',
      MODELENCE_WEB: 'tampered',
      NODE_OPTIONS: '--max-old-space-size=512',
      GREETING: 'hello',
      EMPTY: null,
    };
    const existing = { PORT: '3000', MODELENCE_WEB: 'spec', NODE_OPTIONS: '--enable-source-maps' };
    expect(mergeRuntimeEnv(remote, existing)).toEqual({
      PORT: '3000',
      MODELENCE_WEB: 'spec',
      NODE_OPTIONS: '--max-old-space-size=512',
      GREETING: 'hello',
    });
  });

  it('leaves the existing environment untouched', () => {
    const existing = { GREETING: 'image' };
    mergeRuntimeEnv({ GREETING: 'dashboard' }, existing);
    expect(existing).toEqual({ GREETING: 'image' });
  });
});

describe('fetchRemoteEnv', () => {
  const policy: FetchPolicy = {
    requestTimeoutMs: 100,
    retryWindowMs: 2000,
    firstDelayMs: 10,
    maxDelayMs: 50,
  };
  let server: Server;
  let endpoint: string;
  let requests: number;
  let respond: (request: number, res: ServerResponse) => void;

  beforeEach(async () => {
    requests = 0;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    server = createServer((_req: IncomingMessage, res: ServerResponse) => respond(++requests, res));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('server did not bind to a port');
    }
    endpoint = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const ok = (res: ServerResponse) => res.end(JSON.stringify({ env: { GREETING: 'hi' } }));

  it('gives up on a hung request and succeeds on the next attempt', async () => {
    respond = (request, res) => {
      if (request > 1) ok(res);
      // The first request is never answered.
    };
    expect(await fetchRemoteEnv(endpoint, 'token', policy)).toEqual({ GREETING: 'hi' });
    expect(requests).toBe(2);
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('(attempt 1): no response within 0.1s; retrying in 0.01s')
    );
  });

  it('keeps retrying while Studio answers with errors', async () => {
    respond = (request, res) => {
      if (request > 3) return ok(res);
      res.statusCode = 503;
      res.end();
    };
    expect(await fetchRemoteEnv(endpoint, 'token', policy)).toEqual({ GREETING: 'hi' });
    expect(requests).toBe(4);
  });

  it('fails at once when the service token is rejected', async () => {
    respond = (_request, res) => {
      res.statusCode = 401;
      res.end();
    };
    await expect(fetchRemoteEnv(endpoint, 'token', policy)).rejects.toThrow(
      'HTTP 401: the service token was rejected'
    );
    expect(requests).toBe(1);
  });

  it('fails with the last error once the retry window is over', async () => {
    respond = (_request, res) => {
      res.statusCode = 503;
      res.end();
    };
    const started = Date.now();
    await expect(
      fetchRemoteEnv(endpoint, 'token', { ...policy, retryWindowMs: 200 })
    ).rejects.toThrow(/within 0.2s \(\d+ attempts\): HTTP 503$/);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
