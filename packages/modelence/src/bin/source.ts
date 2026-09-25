import { createWriteStream, promises as fs } from 'fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import archiver from 'archiver';

const execFileAsync = promisify(execFile);

/*
  Packs the project's source tree for a remote build. Inside a git repository
  the file list is git's own (tracked + untracked, minus ignored), so the
  upload matches what a push would carry. Outside git a plain walk is used
  with a fixed exclusion list.

  Local environment files and package-manager credentials are excluded, in
  git or not; environment files committed to git are uploaded (and named).
  Example environment files and placeholder-based registry configuration
  are uploaded too. Symlinks that stay inside the project are kept as links;
  anything that cannot be uploaded as it is (a link leaving the project, a
  git submodule) is reported rather than silently dropped.
*/

export const MAX_SOURCE_BYTES = 200 * 1024 * 1024;

const ALWAYS_EXCLUDED_DIRS = [
  '.git',
  'node_modules',
  '.modelence/build',
  '.modelence/tmp',
  '.modelence/cache',
];
const ALWAYS_EXCLUDED_FILES = [/^\.modelence(\.[^/]+)?\.env$/];

function isLocalEnvFile(name: string): boolean {
  return /^\.env(?:\.|$)/.test(name) && !/\.(example|sample|template)$/.test(name);
}

// Preserve registry URLs and ${TOKEN} references, but never upload literal
// authentication values from a developer's npm or Yarn configuration.
export function hasRegistryCredentials(content: string): boolean {
  return content.split(/\r?\n/).some((line) => {
    if (/^\s*[#;]/.test(line)) return false;
    const credentialsInUrl = /https?:\/\/([^/\s]+)@/.exec(line)?.[1];
    if (
      credentialsInUrl &&
      credentialsInUrl.replace(/\$\{[A-Za-z_][A-Za-z0-9_]*\}/g, '').replace(/:/g, '') !== ''
    ) {
      return true;
    }
    const match =
      /^\s*[^=]*?(?:_authToken|_auth|_password|npmAuthToken|npmAuthIdent)["']?\s*[=:]\s*(.*?)\s*$/i.exec(
        line
      );
    if (!match) return false;
    const value = match[1]
      .replace(/\s+#.*$/, '')
      .replace(/^["']|["']$/g, '')
      .trim();
    return value !== '' && !/^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/.test(value);
  });
}

function toPosix(path: string): string {
  return path.split(sep).join('/');
}

export function isExcludedPath(relativePath: string): boolean {
  return (
    isAlwaysExcludedPath(relativePath) ||
    isLocalEnvFile(toPosix(relativePath).split('/').at(-1) ?? '')
  );
}

// Excluded even when committed: build output, dependencies, Modelence credentials.
function isAlwaysExcludedPath(relativePath: string): boolean {
  const path = toPosix(relativePath);
  const segments = path.split('/');
  for (const dir of ALWAYS_EXCLUDED_DIRS) {
    const dirSegments = dir.split('/');
    // Excluded at any depth for single names (node_modules), at the root for
    // nested ones (.modelence/build).
    if (dirSegments.length === 1) {
      if (segments.slice(0, -1).includes(dir)) {
        return true;
      }
    } else if (path === dir || path.startsWith(`${dir}/`)) {
      return true;
    }
  }
  const fileName = segments[segments.length - 1];
  return ALWAYS_EXCLUDED_FILES.some((pattern) => pattern.test(fileName));
}

async function isGitRepository(cwd: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--is-inside-work-tree'], { cwd });
    return stdout.trim() === 'true';
  } catch {
    return false;
  }
}

async function gitLsFiles(cwd: string, args: string[]): Promise<string[]> {
  const { stdout } = await execFileAsync('git', ['ls-files', ...args, '-z'], {
    cwd,
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout.split('\0').filter((entry) => entry.length > 0);
}

async function walk(cwd: string, dir = ''): Promise<string[]> {
  const entries = await fs.readdir(join(cwd, dir), { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (!isExcludedPath(`${path}/x`)) {
        files.push(...(await walk(cwd, path)));
      }
    } else if (entry.isFile() || entry.isSymbolicLink()) {
      files.push(path);
    }
  }
  return files;
}

export interface SourceSymlink {
  path: string;
  // Relative to the link's own directory, as the archive stores it.
  target: string;
}

export interface SourceListing {
  files: string[];
  symlinks: SourceSymlink[];
  usedGit: boolean;
  // Left out on purpose: build output, dependencies, credentials.
  excludedFiles: string[];
  // In the tree but impossible to upload faithfully, with the reason.
  skipped: { path: string; reason: string }[];
  // Environment files committed to git, uploaded as they are.
  committedEnvFiles: string[];
}

// A link is kept when it resolves inside the project, the root included;
// one that leaves it would upload nothing useful and point at the
// developer's machine.
async function resolveSymlink(cwd: string, file: string): Promise<SourceSymlink | null> {
  const link = join(cwd, file);
  const target = await fs.readlink(link);
  const absolute = resolve(dirname(link), target);
  const fromRoot = relative(cwd, absolute);
  if (fromRoot.startsWith('..') || isAbsolute(fromRoot)) {
    return null;
  }
  // A link to its own directory is '.', never the empty path archiver rejects.
  return { path: file, target: toPosix(relative(dirname(link), absolute)) || '.' };
}

/*
  Inside git, committed .env files are part of the source (typically the
  public VITE_* / NEXT_PUBLIC_* values a build inlines), so they are
  uploaded like any other tracked file. Untracked ones and, outside git, all
  of them are treated as local secrets.
*/
export async function listSourceFiles(cwd = process.cwd()): Promise<SourceListing> {
  const usedGit = await isGitRepository(cwd);
  const tracked = new Set(usedGit ? await gitLsFiles(cwd, ['--cached']) : []);
  const candidates = usedGit
    ? [...tracked, ...(await gitLsFiles(cwd, ['--others', '--exclude-standard']))]
    : await walk(cwd);

  const listing: SourceListing = {
    files: [],
    symlinks: [],
    usedGit,
    excludedFiles: [],
    skipped: [],
    committedEnvFiles: [],
  };
  for (const file of candidates) {
    const name = file.split('/').at(-1) ?? '';
    const localEnv = isLocalEnvFile(name);
    if (isAlwaysExcludedPath(file) || (localEnv && !tracked.has(file))) {
      listing.excludedFiles.push(file);
      continue;
    }
    let stat;
    try {
      stat = await fs.lstat(join(cwd, file));
    } catch {
      // git ls-files still lists tracked files deleted from the working tree.
      continue;
    }
    if (stat.isSymbolicLink()) {
      // A link can stand in for a directory (a workspace's node_modules), so
      // its own name is checked against the excluded directories too.
      if (isAlwaysExcludedPath(`${file}/x`)) {
        listing.excludedFiles.push(file);
        continue;
      }
      const symlink = await resolveSymlink(cwd, file);
      if (symlink) {
        listing.symlinks.push(symlink);
      } else {
        listing.skipped.push({ path: file, reason: 'symlink to outside the project' });
      }
    } else if (stat.isDirectory()) {
      // git lists a submodule as a single entry; its files are in another repository.
      listing.skipped.push({ path: file, reason: 'git submodule' });
    } else if (stat.isFile()) {
      if (
        ['.npmrc', '.yarnrc.yml', '.yarnrc'].includes(name) &&
        hasRegistryCredentials(await fs.readFile(join(cwd, file), 'utf8'))
      ) {
        listing.excludedFiles.push(file);
        continue;
      }
      listing.files.push(file);
      if (localEnv) {
        listing.committedEnvFiles.push(file);
      }
    }
  }
  return {
    ...listing,
    files: listing.files.sort(),
    symlinks: listing.symlinks.sort((a, b) => a.path.localeCompare(b.path)),
    excludedFiles: listing.excludedFiles.sort(),
    committedEnvFiles: listing.committedEnvFiles.sort(),
  };
}

export async function packSource(
  cwd: string,
  zipPath: string
): Promise<Omit<SourceListing, 'files' | 'symlinks'> & { fileCount: number; sizeBytes: number }> {
  const { files, symlinks, ...listing } = await listSourceFiles(cwd);
  if (files.length === 0) {
    throw new Error('No files to upload');
  }

  await fs.mkdir(join(zipPath, '..'), { recursive: true });
  await fs.rm(zipPath, { force: true });

  const output = createWriteStream(zipPath);
  const archive = archiver('zip', { zlib: { level: 6 } });
  const done = new Promise<void>((resolve, reject) => {
    output.on('close', resolve);
    output.on('error', reject);
    archive.on('error', reject);
  });
  archive.pipe(output);
  for (const file of files) {
    archive.file(join(cwd, file), { name: toPosix(relative('', file)) });
  }
  for (const link of symlinks) {
    // Without a mode the entry extracts as an unreadable link.
    archive.symlink(link.path, link.target, 0o777);
  }
  // Together, so an archive error rejects instead of leaving finalize() pending.
  await Promise.all([archive.finalize(), done]);

  const { size } = await fs.stat(zipPath);
  if (size > MAX_SOURCE_BYTES) {
    await fs.rm(zipPath, { force: true });
    throw new Error(
      `Source is ${(size / 1024 / 1024).toFixed(0)} MB compressed; the limit is ${MAX_SOURCE_BYTES / 1024 / 1024} MB. ` +
        'Add build output and large assets to .gitignore.'
    );
  }

  return { ...listing, fileCount: files.length + symlinks.length, sizeBytes: size };
}
