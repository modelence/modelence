import { spawn, spawnSync, type ChildProcess } from 'child_process';
import type { ProcessEnv } from './localEnv';

export function killProcessTree(child: ChildProcess, signal: NodeJS.Signals) {
  if (!child.pid) {
    return;
  }
  if (process.platform === 'win32') {
    // process.kill cannot address a process tree on Windows; taskkill /T walks it.
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    return;
  }
  try {
    // The child leads its own process group (detached), so signaling the
    // negative pid reaches it and every process it started.
    process.kill(-child.pid, signal);
  } catch {
    // The process group is already gone.
  }
}

/*
  Starts a long-running dev process and stops it together with everything it
  started. Signaling only the child is not enough: a shell (`sh -c "a && b"`)
  or a watcher dies on SIGTERM without passing it on, which leaves the dev
  server holding its port. On POSIX the child leads its own process group,
  and every signal goes to the whole group.
*/
export function spawnProcessTree(
  command: string,
  args: string[],
  options: { cwd: string; env: ProcessEnv; shell: boolean }
): ChildProcess {
  const child = spawn(command, args, {
    ...options,
    stdio: 'inherit',
    // On Windows detached opens a new console instead; taskkill /T finds the tree there.
    detached: process.platform !== 'win32',
  });

  let terminating = false;

  const forwardSignal = (signal: NodeJS.Signals) => {
    if (terminating) {
      // A second signal means the graceful teardown is taking too long.
      killProcessTree(child, 'SIGKILL');
      process.exit(1);
    }
    terminating = true;
    killProcessTree(child, signal);
  };

  // The group no longer gets the terminal's Ctrl+C itself, so forward it too.
  process.on('SIGINT', () => forwardSignal('SIGINT'));
  process.on('SIGTERM', () => forwardSignal('SIGTERM'));
  // A terminal hangup reaches this process but not the detached group
  // (its own session has no controlling terminal), so forward it too.
  process.on('SIGHUP', () => forwardSignal('SIGHUP'));
  process.on('SIGQUIT', () => forwardSignal('SIGQUIT'));

  // Last resort: if the parent exits without going through a handled signal,
  // do not leave the tree behind. On POSIX that holds even after the group
  // leader exited, since the processes it started may still be running.
  process.on('exit', () => {
    const exited = child.exitCode !== null || child.signalCode !== null;
    if (process.platform === 'win32' && exited) {
      return;
    }
    killProcessTree(child, 'SIGKILL');
  });

  return child;
}
