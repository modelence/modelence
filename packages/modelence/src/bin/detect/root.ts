import { promises as fs } from 'fs';
import { isAbsolute, relative, resolve, sep } from 'path';

// The archive remains rooted at cwd; commands and detection use the app root.
export async function resolveAppRoot(cwd: string, root = '.'): Promise<string> {
  if (typeof root !== 'string' || isAbsolute(root)) {
    throw new Error('build.root must be a relative directory inside the project.');
  }
  const archiveRoot = await fs.realpath(cwd);
  const candidate = resolve(archiveRoot, root);
  const inside = (path: string) => {
    const rel = relative(archiveRoot, path);
    return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
  };
  if (!inside(candidate)) throw new Error('build.root must stay inside the project.');
  const appRoot = await fs.realpath(candidate);
  if (!inside(appRoot) || !(await fs.stat(appRoot)).isDirectory()) {
    throw new Error('build.root must be a directory inside the project.');
  }
  return appRoot;
}
