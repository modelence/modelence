import { spawn } from 'node:child_process';
import { connect as netConnect } from 'node:net';
import type { ProcessEnv } from './env';
import { log, sleep } from './log';

const FORWARDED_SIGNALS: NodeJS.Signals[] = ['SIGTERM', 'SIGINT'];

// Runs the app, forwards stop signals to it and exits with its exit code.
export function runStartCommand(command: string, env: ProcessEnv): void {
  const child = spawn('sh', ['-c', command], { stdio: 'inherit', env });
  for (const signal of FORWARDED_SIGNALS) {
    process.on(signal, () => child.kill(signal));
  }
  child.on('exit', (code, signal) => {
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
