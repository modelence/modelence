import { getServerPath } from './config';
import { spawn, spawnSync, type ChildProcess } from 'child_process';
import path from 'path';

function killProcessTree(child: ChildProcess, signal: NodeJS.Signals) {
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
    // negative pid reaches the watcher and every process it started.
    process.kill(-child.pid, signal);
  } catch {
    // The process group is already gone.
  }
}

export function dev(options: { takeover?: boolean } = {}) {
  console.log('Starting Modelence dev server...');

  const serverPath = getServerPath();
  const tsxPath = path.resolve('./node_modules/.bin/tsx');

  const env = {
    ...process.env,
    NODE_ENV: 'development',
    ...(options.takeover ? { MODELENCE_TAKEOVER: '1' } : {}),
  };

  const child =
    process.platform === 'win32'
      ? // tsx is a .CMD shim on Windows, so it still needs a shell to launch.
        spawn(`"${tsxPath}" watch --ignore "vite.config.ts.timestamp-*" "${serverPath}"`, {
          stdio: 'inherit',
          cwd: process.cwd(),
          env,
          shell: true,
        })
      : spawn(tsxPath, ['watch', '--ignore', 'vite.config.ts.timestamp-*', serverPath], {
          stdio: 'inherit',
          cwd: process.cwd(),
          env,
          detached: true,
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

  process.on('SIGINT', () => forwardSignal('SIGINT'));
  process.on('SIGTERM', () => forwardSignal('SIGTERM'));
  // A terminal hangup reaches this process but not the detached watcher
  // (its own session has no controlling terminal), so forward it too.
  process.on('SIGHUP', () => forwardSignal('SIGHUP'));
  process.on('SIGQUIT', () => forwardSignal('SIGQUIT'));

  // Last resort: if the parent exits without going through a handled signal,
  // do not leave the watcher tree behind.
  process.on('exit', () => {
    const exited = child.exitCode !== null || child.signalCode !== null;
    if (process.platform === 'win32' && exited) {
      return;
    }
    killProcessTree(child, 'SIGKILL');
  });

  child.on('error', (error) => {
    console.error('Failed to start the dev server:', error);
    process.exit(1);
  });

  child.on('exit', (code, signal) => {
    process.exit(code ?? (signal ? 1 : 0));
  });
}
