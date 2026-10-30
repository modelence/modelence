import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const GIT_IDENTITY = ['-c', 'user.email=test@example.com', '-c', 'user.name=test'];

// Runs git in a test's temp repo. vitest.config.ts clears GIT_* so it can't
// reach the real checkout.
export function testGit(cwd: () => string) {
  return async (...args: string[]) => {
    const { stdout } = await execFileAsync('git', [...GIT_IDENTITY, ...args], { cwd: cwd() });
    return stdout.trim();
  };
}
