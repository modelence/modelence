import { createServer, type IncomingMessage, type Server } from 'node:http';
import { extname } from 'node:path';
import { log } from './log';
import { matchMount, stripMountPrefix, type PreparedMount } from './mounts';
import { proxyRequest, proxyUpgrade } from './proxy';
import { resolveStaticFile, sendFile } from './static';

function isReadRequest(request: IncomingMessage): boolean {
  return request.method === 'GET' || request.method === 'HEAD';
}

/*
  A browser navigation, as opposed to a fetch/XHR call: those are the
  requests a single-page app wants answered with its index.html.
*/
function isNavigation(request: IncomingMessage): boolean {
  return isReadRequest(request) && String(request.headers.accept || '').includes('text/html');
}

/*
  Serves the mounts on `port`; with an appPort, everything the mounts don't
  answer as a file is proxied there.
*/
export function startRouter(mounts: PreparedMount[], port: number, appPort: number | null): Server {
  const server = createServer((request, response) => {
    const urlPath = (request.url || '/').split('?')[0];
    const mount = matchMount(mounts, urlPath);

    if (mount && isReadRequest(request)) {
      const file = resolveStaticFile(mount.root, stripMountPrefix(mount.path, urlPath));
      if (file) {
        sendFile(response, file);
        return;
      }
    }

    if (appPort) {
      proxyRequest(request, response, appPort, mount && isNavigation(request) ? mount.index : null);
      return;
    }

    // Static only: single-page app routes have no extension; real missing
    // assets do.
    if (mount && isReadRequest(request) && mount.index && !extname(urlPath)) {
      sendFile(response, mount.index);
      return;
    }
    response
      .writeHead(mount && !isReadRequest(request) ? 405 : 404, { 'Content-Type': 'text/plain' })
      .end('Not found');
  });

  server.on('upgrade', (request, socket, head) => {
    if (!appPort) {
      socket.destroy();
      return;
    }
    proxyUpgrade(request, socket, head, appPort);
  });

  server.listen(port, () => {
    const served = mounts.map((mount) => `${mount.path} -> ${mount.root}`).join(', ');
    const proxied = appPort ? `, proxying the rest to port ${appPort}` : '';
    log(`Serving ${served} on port ${port}${proxied}`);
  });
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => server.close(() => process.exit(0)));
  }
  return server;
}
