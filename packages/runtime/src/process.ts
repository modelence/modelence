import { spawn } from 'node:child_process';
import { connect as netConnect } from 'node:net';
import type { ProcessEnv } from './env';
import { log, sleep } from './log';

const FORWARDED_SIGNALS: NodeJS.Signals[] = ['SIGTERM', 'SIGINT'];

/*
  The start command runs under `sh -c`, and a shell running a compound command
  (`cd server && node index.js`) does not pass signals on. So the command gets
  its own process group and a stop signal goes to the whole group, reaching the
  app itself. The trap keeps the shell alive until the app has drained (a trap
  with an action is not inherited, so the app keeps default signal handling);
  otherwise the shell would die at once and take the container down with it.
*/
function wrapCommand(command: string): string {
  return `trap 'exit $?' TERM INT\n${command}`;
}

// Runs the app, forwards stop signals to it and exits with its exit code.
export function runStartCommand(command: string, env: ProcessEnv): void {
  const child = spawn('sh', ['-c', wrapCommand(command)], { stdio: 'inherit', env, detached: true });
  let stopping = false;
  for (const signal of FORWARDED_SIGNALS) {
    process.on(signal, () => {
      stopping = true;
      try {
        process.kill(-(child.pid ?? 0), signal);
      } catch {
        // The group is already gone; the exit handler finishes up.
      }
    });
  }
  child.on('exit', (code, signal) => {
    // Dying of the stop signal we sent is a clean stop, not a crash.
    const killed = signal !== null || code === null || code > 128;
    if (stopping && killed) {
      process.exit(0);
    }
    if (signal) {
      log('App exited with signal ' + signal);
      process.exit(1);
    }
    process.exit(code ?? 1);
  });
  child.on('error', (error) => {
    log('Failed to start app: ' + error.message);
    process.exit(1);
  });
}

function canConnect(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = netConnect(port, '127.0.0.1');
    const finish = (ready: boolean) => {
      socket.destroy();
      resolve(ready);
    };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.setTimeout(1000, () => finish(false));
  });
}

/*
  ECS probes the public router port. Keep it closed until the backend can
  accept traffic, so a hung startup cannot replace healthy containers.
*/
export async function waitForApp(port: number): Promise<void> {
  while (!(await canConnect(port))) {
    await sleep(100);
  }
}
