import {
  Agent,
  request as httpRequest,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { connect as netConnect } from 'node:net';
import type { Duplex } from 'node:stream';
import { log } from './log';
import { sendFile } from './static';

const HOP_BY_HOP_HEADERS = [
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
];

type OutgoingHeaders = Record<string, string | string[] | undefined>;

function withoutHopByHop(headers: IncomingHttpHeaders): OutgoingHeaders {
  const result: OutgoingHeaders = {};
  for (const [name, value] of Object.entries(headers)) {
    if (!HOP_BY_HOP_HEADERS.includes(name.toLowerCase())) {
      result[name] = value;
    }
  }
  return result;
}

function forwardedHeaders(request: IncomingMessage): OutgoingHeaders {
  const headers = withoutHopByHop(request.headers);
  const clientAddress = request.socket.remoteAddress || '';
  headers['x-forwarded-for'] = headers['x-forwarded-for']
    ? headers['x-forwarded-for'] + ', ' + clientAddress
    : clientAddress;
  headers['x-forwarded-proto'] = headers['x-forwarded-proto'] || 'http';
  headers['x-forwarded-host'] = headers['x-forwarded-host'] || request.headers.host || '';
  return headers;
}

const agent = new Agent({ keepAlive: true });

/*
  Forwards a request to the app. With a fallbackFile, a 404 from the app is
  answered with that file instead: the browser asked for a page the app has
  no route for, so it is a client-side route of the mounted single-page app.
*/
export function proxyRequest(
  request: IncomingMessage,
  response: ServerResponse,
  appPort: number,
  fallbackFile: string | null
): void {
  const upstream = httpRequest(
    {
      host: '127.0.0.1',
      port: appPort,
      method: request.method,
      path: request.url,
      headers: forwardedHeaders(request),
      agent,
    },
    (upstreamResponse) => {
      if (fallbackFile && upstreamResponse.statusCode === 404) {
        upstreamResponse.resume();
        sendFile(response, fallbackFile);
        return;
      }
      response.writeHead(
        upstreamResponse.statusCode || 502,
        upstreamResponse.statusMessage,
        withoutHopByHop(upstreamResponse.headers)
      );
      upstreamResponse.pipe(response);
    }
  );
  upstream.on('error', (error: NodeJS.ErrnoException) => {
    if (response.headersSent) {
      response.destroy();
      return;
    }
    response
      .writeHead(503, { 'Content-Type': 'text/plain', 'Retry-After': '2' })
      .end('Application is starting');
    if (error.code !== 'ECONNREFUSED') {
      log('Proxy error: ' + error.message);
    }
  });
  request.pipe(upstream);
}

// WebSockets and other upgrades go straight through to the app's socket.
export function proxyUpgrade(
  request: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  appPort: number
): void {
  const upstream = netConnect(appPort, '127.0.0.1', () => {
    const lines = [`${request.method} ${request.url} HTTP/${request.httpVersion}`];
    for (let index = 0; index < request.rawHeaders.length; index += 2) {
      lines.push(request.rawHeaders[index] + ': ' + request.rawHeaders[index + 1]);
    }
    upstream.write(lines.join('\r\n') + '\r\n\r\n');
    if (head && head.length > 0) {
      upstream.write(head);
    }
    socket.pipe(upstream).pipe(socket);
  });
  upstream.on('error', () => socket.destroy());
  socket.on('error', () => upstream.destroy());
}
