import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WEB_SPEC_ENV_NAME } from '../spec';

/*
  The bin runs as PID 1 on a bare Node image, so it is exercised the way it
  will run: the built dist/bin.js (see globalSetup.ts) executed as a child
  process in each of its three modes — process only, static only, and the
  router in front of a process.
*/

const scriptPath = fileURLToPath(new URL('../../dist/bin.js', import.meta.url));

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      if (!address || typeof address === 'string') {
        reject(new Error('no port'));
        return;
      }
      const { port } = address;
      probe.close(() => resolve(port));
    });
  });
}

function runEntrypoint(env: Record<string, string>, cwd?: string) {
  return new Promise<{ code: number | null; stdout: string }>((resolve) => {
    const child = spawn(process.execPath, [scriptPath], {
      cwd,
      env: { PATH: process.env.PATH ?? '', ...env },
    });
    let stdout = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.on('exit', (code) => resolve({ code, stdout }));
  });
}

// Starts the entrypoint and resolves once its router reports listening.
function startEntrypoint(env: Record<string, string>, cwd: string): Promise<ChildProcess> {
  const child = spawn(process.execPath, [scriptPath], {
    cwd,
    env: { PATH: process.env.PATH ?? '', ...env },
  });
  return new Promise((resolve, reject) => {
    let output = '';
    child.stdout?.on('data', (chunk) => {
      output += String(chunk);
      if (output.includes('Serving')) {
        resolve(child);
      }
    });
    child.stderr?.on('data', (chunk) => {
      output += String(chunk);
    });
    child.on('exit', (code) => reject(new Error(`entrypoint exited with ${code}: ${output}`)));
  });
}

function webSpec(web: { start?: string; static?: { path: string; dir: string }[] }): string {
  return JSON.stringify(web);
}

describe('process mode', () => {
  let server: Server;
  let endpoint: string;
  let receivedAuthorization: string | undefined;

  beforeAll(async () => {
    server = createServer((req, res) => {
      receivedAuthorization = req.headers.authorization;
      if (req.url === '/api/env') {
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            env: { MONGODB_URI: 'mongodb://stub', GREETING: 'hi from studio', PORT: '9999' },
          })
        );
        return;
      }
      res.statusCode = 404;
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('server did not bind to a port');
    }
    endpoint = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('fetches the environment with the service token and runs the start command with it', async () => {
    const { code, stdout } = await runEntrypoint({
      MODELENCE_SERVICE_ENDPOINT: endpoint,
      MODELENCE_SERVICE_TOKEN: 'svc-token',
      PORT: '3000',
      [WEB_SPEC_ENV_NAME]: webSpec({
        start: `${process.execPath} -e "console.log(process.env.GREETING + '|' + process.env.MONGODB_URI + '|' + process.env.PORT)"`,
      }),
    });
    expect(receivedAuthorization).toBe('Bearer svc-token');
    expect(stdout).toContain('hi from studio|mongodb://stub|3000');
    expect(code).toBe(0);
  });

  it('propagates the start command exit code', async () => {
    const { code } = await runEntrypoint({
      [WEB_SPEC_ENV_NAME]: webSpec({ start: `${process.execPath} -e "process.exit(3)"` }),
    });
    expect(code).toBe(3);
  });

  it('fails when the web spec is missing or empty', async () => {
    const missing = await runEntrypoint({});
    expect(missing.code).toBe(1);
    expect(missing.stdout).toContain(WEB_SPEC_ENV_NAME);

    const empty = await runEntrypoint({ [WEB_SPEC_ENV_NAME]: webSpec({}) });
    expect(empty.code).toBe(1);
    expect(empty.stdout).toContain('Nothing to run');
  });
});

describe('static mode', () => {
  let child: ChildProcess | null = null;
  let base = '';
  let siteDir = '';

  beforeAll(async () => {
    siteDir = await mkdtemp(join(tmpdir(), 'modelence-site-'));
    await mkdir(join(siteDir, 'dist', 'assets'), { recursive: true });
    await writeFile(join(siteDir, 'dist', 'index.html'), '<h1>home</h1>');
    await writeFile(join(siteDir, 'dist', 'assets', 'app-Ab12Cd34.js'), 'console.log(1)');
    await writeFile(join(siteDir, 'dist', 'robots.txt'), 'User-agent: *');
    await writeFile(join(siteDir, 'dist', 'locked.txt'), 'secret');
    await chmod(join(siteDir, 'dist', 'locked.txt'), 0o000);
    const port = await freePort();
    child = await startEntrypoint(
      {
        PORT: String(port),
        [WEB_SPEC_ENV_NAME]: webSpec({ static: [{ path: '/', dir: 'dist' }] }),
      },
      siteDir
    );
    base = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    child?.kill();
    await rm(siteDir, { recursive: true, force: true });
  });

  it('serves files with content types and immutable caching for hashed assets', async () => {
    const home = await fetch(`${base}/`);
    expect(home.headers.get('content-type')).toContain('text/html');
    expect(home.headers.get('cache-control')).toBe('no-cache');
    expect(await home.text()).toBe('<h1>home</h1>');

    const asset = await fetch(`${base}/assets/app-Ab12Cd34.js`);
    expect(asset.headers.get('content-type')).toContain('text/javascript');
    expect(asset.headers.get('cache-control')).toContain('immutable');
  });

  it('falls back to index.html for app routes but 404s missing assets', async () => {
    const route = await fetch(`${base}/some/client/route`);
    expect(route.status).toBe(200);
    expect(await route.text()).toBe('<h1>home</h1>');

    const missing = await fetch(`${base}/assets/missing.js`);
    expect(missing.status).toBe(404);
  });

  it('blocks path traversal', async () => {
    const response = await fetch(`${base}/..%2F..%2Fetc%2Fpasswd`);
    expect(response.status).not.toBe(200);
  });

  it('answers an unreadable file with a 500 and keeps serving', async () => {
    // Root can read anything, so the permission bit has no effect there.
    if (process.getuid?.() === 0) {
      return;
    }
    const locked = await fetch(`${base}/locked.txt`);
    expect(locked.status).toBe(500);
    const home = await fetch(`${base}/`);
    expect(home.status).toBe(200);
  });

  it('refuses to start when a static directory is missing', async () => {
    const { code, stdout } = await runEntrypoint(
      {
        PORT: String(await freePort()),
        [WEB_SPEC_ENV_NAME]: webSpec({ static: [{ path: '/', dir: 'nope' }] }),
      },
      siteDir
    );
    expect(code).toBe(1);
    expect(stdout).toContain('does not exist');
  });
});

describe('router mode (static mounts in front of a process)', () => {
  let child: ChildProcess | null = null;
  let base = '';
  let projectDir = '';

  beforeAll(async () => {
    projectDir = await mkdtemp(join(tmpdir(), 'modelence-router-'));
    await mkdir(join(projectDir, 'client', 'dist', 'assets'), { recursive: true });
    await mkdir(join(projectDir, 'docs'), { recursive: true });
    await writeFile(join(projectDir, 'client', 'dist', 'index.html'), '<h1>spa</h1>');
    await writeFile(join(projectDir, 'client', 'dist', 'assets', 'app-Ab12Cd34.js'), '1');
    await writeFile(join(projectDir, 'docs', 'guide.txt'), 'read me');
    // A tiny backend: JSON on /api, 404 elsewhere, echoing forwarded headers.
    await writeFile(
      join(projectDir, 'server.mjs'),
      `import { createServer } from 'node:http';
createServer((req, res) => {
  if (req.url.startsWith('/api/')) {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ path: req.url, port: process.env.PORT, host: req.headers['x-forwarded-host'] }));
    return;
  }
  res.statusCode = 404;
  res.end('Cannot GET ' + req.url);
}).listen(Number(process.env.PORT), '127.0.0.1');
`
    );
    const port = await freePort();
    const appPort = await freePort();
    child = await startEntrypoint(
      {
        PORT: String(port),
        MODELENCE_APP_PORT: String(appPort),
        [WEB_SPEC_ENV_NAME]: webSpec({
          start: `${process.execPath} server.mjs`,
          static: [
            { path: '/', dir: 'client/dist' },
            { path: '/docs', dir: 'docs' },
          ],
        }),
      },
      projectDir
    );
    base = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    child?.kill();
    await rm(projectDir, { recursive: true, force: true });
  });

  it('serves mounted files and proxies the rest, with the app on its own port', async () => {
    expect(await (await fetch(`${base}/`)).text()).toBe('<h1>spa</h1>');
    expect(await (await fetch(`${base}/docs/guide.txt`)).text()).toBe('read me');

    const api = await fetch(`${base}/api/items?x=1`);
    const body = (await api.json()) as { path: string; port: string; host: string };
    expect(body.path).toBe('/api/items?x=1');
    // fetch never lets a caller set Host, so the forwarded host is the router's own.
    expect(body.host).toBe(new URL(base).host);
    expect(body.port).not.toBe(new URL(base).port);
  });

  it('answers browser navigations the app does not know with the mount index, fetches get the 404', async () => {
    const navigation = await fetch(`${base}/contacts/42`, { headers: { accept: 'text/html' } });
    expect(navigation.status).toBe(200);
    expect(await navigation.text()).toBe('<h1>spa</h1>');

    const apiCall = await fetch(`${base}/contacts/42`, { headers: { accept: 'application/json' } });
    expect(apiCall.status).toBe(404);
    expect(await apiCall.text()).toBe('Cannot GET /contacts/42');

    // A mount without index.html has no fallback.
    const docsNavigation = await fetch(`${base}/docs/missing`, {
      headers: { accept: 'text/html' },
    });
    expect(docsNavigation.status).toBe(404);
  });
});

it('keeps the public port closed until the backend accepts connections', async () => {
  const projectDir = await mkdtemp(join(tmpdir(), 'modelence-readiness-'));
  await mkdir(join(projectDir, 'dist'));
  await writeFile(join(projectDir, 'dist', 'index.html'), 'ready');
  const port = await freePort();
  const appPort = await freePort();
  const backend = createServer((_req, res) => res.end('backend ready'));
  const child = spawn(process.execPath, [scriptPath], {
    cwd: projectDir,
    env: {
      PATH: process.env.PATH ?? '',
      PORT: String(port),
      MODELENCE_APP_PORT: String(appPort),
      [WEB_SPEC_ENV_NAME]: webSpec({
        start: `exec "${process.execPath}" -e "setInterval(() => {}, 1000)"`,
        static: [{ path: '/', dir: 'dist' }],
      }),
    },
  });
  const waitForLog = (message: string) =>
    new Promise<void>((resolve, reject) => {
      const onData = (chunk: Buffer) => {
        if (String(chunk).includes(message)) {
          child.stdout.off('data', onData);
          resolve();
        }
      };
      child.stdout.on('data', onData);
      child.once('exit', (code) => reject(new Error(`Exited before ${message}: ${code}`)));
    });
  const serving = waitForLog('Serving');
  try {
    await waitForLog('Starting on port');
    await expect(fetch(`http://127.0.0.1:${port}/`)).rejects.toThrow();
    await new Promise<void>((resolve) => backend.listen(appPort, '127.0.0.1', resolve));
    await serving;
    expect(await (await fetch(`http://127.0.0.1:${port}/api`)).text()).toBe('backend ready');
  } finally {
    child.kill();
    await new Promise<void>((resolve) => child.once('exit', () => resolve()));
    backend.closeAllConnections();
    await new Promise<void>((resolve) => backend.close(() => resolve()));
    await rm(projectDir, { recursive: true, force: true });
  }
});

describe('shutdown', () => {
  let projectDir = '';

  // Drains for a moment on SIGTERM, like an app finishing in-flight requests.
  beforeAll(async () => {
    projectDir = await mkdtemp(join(tmpdir(), 'modelence-shutdown-'));
    await mkdir(join(projectDir, 'dist'));
    await writeFile(join(projectDir, 'dist', 'index.html'), 'home');
    await writeFile(
      join(projectDir, 'drain.mjs'),
      `import { createServer } from 'node:http';
const server = createServer((_req, res) => res.end('ok'));
server.listen(Number(process.env.PORT), '127.0.0.1', () => console.log('app ready'));
process.on('SIGTERM', () => {
  console.log('draining');
  setTimeout(() => {
    console.log('drained');
    process.exit(0);
  }, 300);
});
`
    );
  });

  afterAll(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  // Starts the entrypoint, sends SIGTERM once `ready` is logged and collects the result.
  function stopAfter(ready: string, env: Record<string, string>) {
    return new Promise<{ code: number | null; output: string }>((resolve) => {
      const child = spawn(process.execPath, [scriptPath], {
        cwd: projectDir,
        env: { PATH: process.env.PATH ?? '', ...env },
      });
      let output = '';
      let signalled = false;
      const onData = (chunk: Buffer) => {
        output += String(chunk);
        if (!signalled && output.includes(ready)) {
          signalled = true;
          child.kill('SIGTERM');
        }
      };
      child.stdout.on('data', onData);
      child.stderr.on('data', onData);
      child.on('exit', (code) => resolve({ code, output }));
    });
  }

  // `&& true` keeps the shell around instead of exec-ing the app.
  const start = `"${process.execPath}" drain.mjs && true`;

  it('stops the app behind a shell and waits for it to drain', async () => {
    const { code, output } = await stopAfter('app ready', {
      PORT: String(await freePort()),
      [WEB_SPEC_ENV_NAME]: webSpec({ start }),
    });
    expect(output).toContain('drained');
    expect(code).toBe(0);
  });

  it('keeps the router up until the app behind it has drained', async () => {
    const { code, output } = await stopAfter('Serving', {
      PORT: String(await freePort()),
      MODELENCE_APP_PORT: String(await freePort()),
      [WEB_SPEC_ENV_NAME]: webSpec({ start, static: [{ path: '/', dir: 'dist' }] }),
    });
    expect(output).toContain('drained');
    expect(code).toBe(0);
  });
});
