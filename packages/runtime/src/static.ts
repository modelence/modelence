import { createReadStream, statSync } from 'node:fs';
import type { ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { log } from './log';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wasm': 'application/wasm',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.pdf': 'application/pdf',
};

// Vite/CRA emit content-hashed files under assets/ or static/; everything
// else (index.html above all) must revalidate so deploys show up.
const IMMUTABLE_ASSET = /[\\/](assets|static)[\\/][^\\/]*[.-][0-9a-zA-Z_-]{6,}\./;

/*
  Maps a request path to a file inside the site root, or null when it is not
  a regular file. Traversal is blocked by resolving and re-checking the
  prefix rather than by pattern matching.
*/
export function resolveStaticFile(root: string, urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0]);
  } catch {
    return null;
  }
  const target = resolve(root, '.' + normalize('/' + decoded));
  if (target !== root && !target.startsWith(root + sep)) {
    return null;
  }
  try {
    const stat = statSync(target);
    if (stat.isFile()) {
      return target;
    }
    if (stat.isDirectory()) {
      const index = join(target, 'index.html');
      return statSync(index).isFile() ? index : null;
    }
  } catch {
    // Missing — the caller decides between SPA fallback, proxy and 404.
  }
  return null;
}

export function sendFile(response: ServerResponse, filePath: string, status = 200): void {
  const type = MIME_TYPES[extname(filePath).toLowerCase()] || 'application/octet-stream';
  const immutable = IMMUTABLE_ASSET.test(filePath);
  const stream = createReadStream(filePath);
  // Headers go out once the file is open, so an unreadable file (deleted
  // between stat and read, a permission problem) is a 500 for this request
  // rather than a crash of the whole router.
  stream.once('open', () => {
    response.writeHead(status, {
      'Content-Type': type,
      'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    stream.pipe(response);
  });
  stream.once('error', (error) => {
    log('Could not read ' + filePath + ': ' + error.message);
    if (response.headersSent) {
      response.destroy();
      return;
    }
    response.writeHead(500, { 'Content-Type': 'text/plain' }).end('Internal server error');
  });
}
