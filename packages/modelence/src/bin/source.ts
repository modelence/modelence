import { createWriteStream, promises as fs } from 'fs';
import { join, relative, sep } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import archiver from 'archiver';

const execFileAsync = promisify(execFile);

/*
  Packs the project's source tree for a remote build. Inside a git repository
  the file list is git's own (tracked + untracked, minus ignored), so the
  upload matches what a push would carry. Outside git a plain walk is used
  with a fixed exclusion list.

  Local environment files and package-manager credentials are excluded even
  outside Git. Example environment files and placeholder-based registry
  configuration can be committed and uploaded.
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
  return (
    isLocalEnvFile(fileName) || ALWAYS_EXCLUDED_FILES.some((pattern) => pattern.test(fileName))
  );
}

async function isGitRepository(cwd: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--is-inside-work-tree'], { cwd });
    return stdout.trim() === 'true';
  } catch {
    return false;
  }
}

async function listGitFiles(cwd: string): Promise<string[]> {
  const { stdout } = await execFileAsync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { cwd, maxBuffer: 64 * 1024 * 1024 }
  );
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
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return files;
}

export async function listSourceFiles(
  cwd = process.cwd()
): Promise<{ files: string[]; usedGit: boolean; excludedFiles: string[] }> {
  const usedGit = await isGitRepository(cwd);
  const candidates = usedGit ? await listGitFiles(cwd) : await walk(cwd);

  const files: string[] = [];
  const excludedFiles: string[] = [];
  for (const file of candidates) {
    if (isExcludedPath(file)) {
      excludedFiles.push(file);
      continue;
    }
    // git ls-files still lists tracked files deleted from the working tree.
    try {
      const stat = await fs.lstat(join(cwd, file));
      if (stat.isFile()) {
        if (
          ['.npmrc', '.yarnrc.yml', '.yarnrc'].includes(file.split('/').at(-1) ?? '') &&
          hasRegistryCredentials(await fs.readFile(join(cwd, file), 'utf8'))
        ) {
          excludedFiles.push(file);
          continue;
        }
        files.push(file);
      }
    } catch {
      // Gone from disk — nothing to upload.
    }
  }
  return { files: files.sort(), usedGit, excludedFiles: excludedFiles.sort() };
}

export async function packSource(
  cwd: string,
  zipPath: string
): Promise<{ fileCount: number; sizeBytes: number; usedGit: boolean; excludedFiles: string[] }> {
  const { files, usedGit, excludedFiles } = await listSourceFiles(cwd);
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
  await archive.finalize();
  await done;

  const { size } = await fs.stat(zipPath);
  if (size > MAX_SOURCE_BYTES) {
    await fs.rm(zipPath, { force: true });
    throw new Error(
      `Source is ${(size / 1024 / 1024).toFixed(0)} MB compressed; the limit is ${MAX_SOURCE_BYTES / 1024 / 1024} MB. ` +
        'Add build output and large assets to .gitignore.'
    );
  }

  return { fileCount: files.length, sizeBytes: size, usedGit, excludedFiles };
}
