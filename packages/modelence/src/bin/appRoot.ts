import { promises as fs } from 'fs';
import { isAbsolute, relative, resolve, sep } from 'path';

// The archive remains rooted at cwd; a resource's root only picks the directory
// Studio runs the commands in. It has to exist and stay inside the upload,
// symlinks included, or the build would run against files that were never
// sent.
export async function resolveAppRoot(cwd: string, root = '.'): Promise<string> {
  if (typeof root !== 'string' || isAbsolute(root)) {
    throw new Error('root must be a relative directory inside the project.');
  }
  const archiveRoot = await fs.realpath(cwd);
  const candidate = resolve(archiveRoot, root);
  if (!isInside(archiveRoot, candidate)) {
    throw new Error('root must stay inside the project.');
  }
  let appRoot: string;
  try {
    appRoot = await fs.realpath(candidate);
  } catch {
    throw new Error(`root "${root}" does not exist.`);
  }
  if (!isInside(archiveRoot, appRoot) || !(await fs.stat(appRoot)).isDirectory()) {
    throw new Error('root must be a directory inside the project.');
  }
  return appRoot;
}

function isInside(base: string, path: string): boolean {
  const rel = relative(base, path);
  return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}
