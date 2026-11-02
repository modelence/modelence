import { existsSync, readFileSync } from 'fs';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawnProcessTree } from './processTree';

type Listener = (...args: unknown[]) => void;

const EVENTS = ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGQUIT', 'exit'] as const;

function listenersOf(event: (typeof EVENTS)[number]): Listener[] {
  return (event === 'exit' ? process.listeners('exit') : process.listeners(event)) as Listener[];
}

async function waitUntil(condition: () => boolean, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error('Timed out');
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const groupExists = (pgid: number) => isAlive(-pgid);

// Real processes: what is under test is how the OS delivers the signals.
describe.skipIf(process.platform === 'win32')('spawnProcessTree', () => {
  let dir: string;
  let listenersBefore: Map<(typeof EVENTS)[number], Listener[]>;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'modelence-tree-'));
    listenersBefore = new Map(EVENTS.map((event) => [event, listenersOf(event)]));
  });

  afterEach(async () => {
    for (const [event, before] of listenersBefore) {
      for (const listener of listenersOf(event)) {
        if (!before.includes(listener)) {
          process.removeListener(event, listener);
        }
      }
    }
    await rm(dir, { recursive: true, force: true });
  });

  it('stops what a shell started, which sh alone would leave running on SIGTERM', async () => {
    const marker = join(dir, 'started');
    const child = spawnProcessTree(`true && touch "${marker}" && sleep 77`, [], {
      cwd: dir,
      env: process.env,
      shell: true,
    });
    const exited = new Promise((resolve) => child.once('exit', resolve));
    await waitUntil(() => existsSync(marker));
    // Let sh start sleep after touch.
    await new Promise((resolve) => setTimeout(resolve, 100));

    process.emit('SIGTERM');

    await exited;
    await waitUntil(() => !groupExists(child.pid!));
    expect(groupExists(child.pid!)).toBe(false);
  });

  /*
    A framework app with a config: `modelence dev` runs `npm run dev`, which
    runs `modelence dev` again. npm dies on SIGTERM at once, so the outer CLI
    exits and SIGKILLs its group while the inner one still waits for its
    server, here one that ignores SIGTERM like a slow shutdown.
  */
  it('stops the server of a nested run with the outer tree', async () => {
    const pidFile = join(dir, 'server.pid');
    const inner = join(dir, 'inner.ts');
    await writeFile(
      inner,
      `import { spawnProcessTree } from ${JSON.stringify(resolve(__dirname, 'processTree.ts'))};
const command = 'trap "" TERM; echo $$ > ${pidFile}; exec sleep 82';
const child = spawnProcessTree(command, [], { cwd: process.cwd(), env: process.env, shell: true, inParentTree: true });
child.on('exit', (code) => process.exit(code ?? 1));
`
    );
    const tsx = resolve(__dirname, '../../node_modules/.bin/tsx');
    const child = spawnProcessTree(`"${tsx}" "${inner}"; true`, [], {
      cwd: dir,
      env: process.env,
      shell: true,
    });
    const exited = new Promise((resolve) => child.once('exit', resolve));
    await waitUntil(() => existsSync(pidFile) && readFileSync(pidFile, 'utf-8').trim() !== '');
    const serverPid = Number(readFileSync(pidFile, 'utf-8'));

    try {
      process.emit('SIGTERM');
      await exited;
      // What the outer CLI's exit handler does as it exits with its child.
      const backstop = listenersOf('exit').find(
        (listener) => !listenersBefore.get('exit')!.includes(listener)
      );
      backstop!();

      await waitUntil(() => !isAlive(serverPid));
    } finally {
      if (isAlive(serverPid)) {
        process.kill(serverPid, 'SIGKILL');
      }
    }
    expect(isAlive(serverPid)).toBe(false);
  }, 15000);
});
