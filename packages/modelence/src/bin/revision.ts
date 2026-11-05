import { promises as fs } from 'fs';
import { join } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface SourceRevision {
  appVersion?: string;
  commitSha?: string;
}

/*
  What Studio shows next to the deploy on its builds page: the package.json
  version and the git HEAD. Each is left out when it can't be read; neither
  ever stops a deploy.

  The SHA is also left out when the working tree has changes: the upload
  would then not be that commit, and Studio's publish flow compares this SHA
  with the sandbox's to decide whether there is anything new to ship.
*/
export async function readSourceRevision(cwd: string): Promise<SourceRevision> {
  const [appVersion, commitSha] = await Promise.all([readVersion(cwd), readHeadSha(cwd)]);
  return {
    ...(appVersion ? { appVersion } : {}),
    ...(commitSha ? { commitSha } : {}),
  };
}

async function readVersion(cwd: string): Promise<string | undefined> {
  try {
    const { version } = JSON.parse(await fs.readFile(join(cwd, 'package.json'), 'utf8'));
    return typeof version === 'string' && version ? version : undefined;
  } catch {
    return undefined;
  }
}

// What git says when there is simply no commit to report.
const NO_COMMIT = /not a git repository|unknown revision/i;

async function readHeadSha(cwd: string): Promise<string | undefined> {
  // Short: nothing here may hold up a deploy.
  const git = (args: string[]) => execFileAsync('git', args, { cwd, timeout: 5000 });
  try {
    const { stdout: head } = await git(['rev-parse', 'HEAD']);
    const { stdout: changes } = await git(['status', '--porcelain']);
    const sha = head.trim();
    // Studio and the sandbox only take SHA-1; a SHA-256 repo shows no SHA.
    return changes.trim() === '' && /^[0-9a-f]{40}$/i.test(sha) ? sha : undefined;
  } catch (error) {
    const { code, stderr } = error as { code?: string; stderr?: string };
    const message = stderr?.trim() || (error as Error).message;
    // No git installed, or no repo or commit: nothing to say. Anything else
    // (e.g. "dubious ownership" in Docker CI) would leave the SHA missing
    // from the builds page with no hint why.
    if (code !== 'ENOENT' && !NO_COMMIT.test(message)) {
      console.warn(`Could not read the git commit for this deploy: ${message.split('\n')[0]}`);
    }
    return undefined;
  }
}
