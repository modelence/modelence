import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import { log } from './log';
import type { StaticMount } from './spec';
import { resolveStaticFile } from './static';

export interface PreparedMount {
  path: string;
  // Absolute directory the mount serves.
  root: string;
  // The mount's index.html, for single-page app fallback; null without one.
  index: string | null;
}

function prefixOf(mountPath: string): string {
  return mountPath === '/' ? '' : mountPath;
}

/*
  The mount owning a URL path: the longest prefix that matches. '/' matches
  everything; '/docs' matches '/docs' and '/docs/…' but not '/docsx'.
*/
export function matchMount<T extends { path: string }>(mounts: T[], urlPath: string): T | null {
  let best: T | null = null;
  for (const mount of mounts) {
    const prefix = prefixOf(mount.path);
    const matches = prefix === '' || urlPath === prefix || urlPath.startsWith(prefix + '/');
    if (matches && (!best || prefix.length > prefixOf(best.path).length)) {
      best = mount;
    }
  }
  return best;
}

export function stripMountPrefix(mountPath: string, urlPath: string): string {
  if (mountPath === '/') {
    return urlPath;
  }
  const rest = urlPath.slice(mountPath.length);
  return rest === '' ? '/' : rest;
}

// Resolves each mount against the working directory; a missing directory is
// fatal, since the build was expected to produce it.
export function prepareMounts(mounts: StaticMount[], cwd: string): PreparedMount[] {
  return mounts.map((mount) => {
    const root = resolve(cwd, mount.dir);
    let isDirectory = false;
    try {
      isDirectory = statSync(root).isDirectory();
    } catch {
      // Reported below.
    }
    if (!isDirectory) {
      log(
        `Static directory ${root} does not exist. Check the build command and the static directories.`
      );
      process.exit(1);
    }
    const index = resolveStaticFile(root, '/index.html');
    if (!index) {
      log(`No index.html in ${root}; files are served but there is no single-page app fallback.`);
    }
    return { path: mount.path, root, index };
  });
}
