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

async function readHeadSha(cwd: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd });
    const sha = stdout.trim();
    return /^[0-9a-f]{40}$/i.test(sha) ? sha : undefined;
  } catch {
    return undefined;
  }
}
