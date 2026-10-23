import { existsSync } from 'fs';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
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

function groupExists(pgid: number): boolean {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch {
    return false;
  }
}

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
});
