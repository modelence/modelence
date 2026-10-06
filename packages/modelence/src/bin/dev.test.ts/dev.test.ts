import { EventEmitter } from 'events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const spawnMock = vi.fn();
const spawnSyncMock = vi.fn();

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return {
    ...actual,
    spawn: (...args: unknown[]) => spawnMock(...args),
    spawnSync: (...args: unknown[]) => spawnSyncMock(...args),
  };
});

vi.mock('./config', () => ({
  getServerPath: () => 'src/server.ts',
}));

class FakeChild extends EventEmitter {
  pid = 12345;
  killed = false;
}

type Listener = (...args: unknown[]) => void;

describe('dev', () => {
  let sigintBefore: Listener[];
  let sigtermBefore: Listener[];
  let exitBefore: Listener[];
  let killSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let platformSpy: ReturnType<typeof vi.spyOn>;
  let fakeChild: FakeChild;

  const removeAddedListeners = (event: string, before: Listener[]) => {
    for (const listener of process.listeners(event)) {
      if (!before.includes(listener as Listener)) {
        process.removeListener(event, listener);
      }
    }
  };

  beforeEach(async () => {
    sigintBefore = process.listeners('SIGINT') as Listener[];
    sigtermBefore = process.listeners('SIGTERM') as Listener[];
    exitBefore = process.listeners('exit') as Listener[];

    fakeChild = new FakeChild();
    spawnMock.mockReset().mockReturnValue(fakeChild);
    spawnSyncMock.mockReset();
    killSpy = vi.spyOn(process, 'kill').mockReturnValue(true);
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');

    vi.resetModules();
    const { dev } = await import('./dev');
    dev();
  });

  afterEach(() => {
    removeAddedListeners('SIGINT', sigintBefore);
    removeAddedListeners('SIGTERM', sigtermBefore);
    removeAddedListeners('exit', exitBefore);
    vi.restoreAllMocks();
  });

  it('spawns tsx watch detached in its own process group on POSIX', () => {
    expect(spawnMock).toHaveBeenCalledOnce();
    const [command, args, options] = spawnMock.mock.calls[0];
    expect(command).toMatch(/node_modules\/\.bin\/tsx$/);
    expect(args).toEqual(['watch', '--ignore', 'vite.config.ts.timestamp-*', 'src/server.ts']);
    expect(options).toMatchObject({ stdio: 'inherit', detached: true });
    expect(options.env).toMatchObject({ NODE_ENV: 'development' });
    expect(options.env.MODELENCE_TAKEOVER).toBeUndefined();
  });

  it('forwards SIGTERM to the whole child process group', () => {
    process.emit('SIGTERM');
    expect(killSpy).toHaveBeenCalledWith(-fakeChild.pid, 'SIGTERM');
  });

  it('forwards SIGINT to the whole child process group', () => {
    process.emit('SIGINT');
    expect(killSpy).toHaveBeenCalledWith(-fakeChild.pid, 'SIGINT');
  });

  it('force-kills the tree and exits on a second signal', () => {
    process.emit('SIGINT');
    process.emit('SIGINT');
    expect(killSpy).toHaveBeenCalledWith(-fakeChild.pid, 'SIGKILL');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('kills the tree if the parent exits without a handled signal', () => {
    process.emit('exit', 0);
    expect(killSpy).toHaveBeenCalledWith(-fakeChild.pid, 'SIGKILL');
  });

  it('propagates the child exit code', () => {
    fakeChild.emit('exit', 2, null);
    expect(exitSpy).toHaveBeenCalledWith(2);
  });

  it('exits non-zero when the child is killed by a signal', () => {
    fakeChild.emit('exit', null, 'SIGTERM');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('ignores signals when the process group is already gone', () => {
    killSpy.mockImplementation(() => {
      throw new Error('ESRCH');
    });
    expect(() => process.emit('SIGTERM')).not.toThrow();
  });

  it('uses a shell and taskkill /T on Windows', async () => {
    platformSpy.mockReturnValue('win32');
    removeAddedListeners('SIGINT', sigintBefore);
    removeAddedListeners('SIGTERM', sigtermBefore);
    removeAddedListeners('exit', exitBefore);

    vi.resetModules();
    const { dev } = await import('./dev');
    dev();

    expect(spawnMock).toHaveBeenCalledTimes(2);
    const [command, options] = spawnMock.mock.calls[1];
    expect(command).toContain('tsx');
    expect(options).toMatchObject({ stdio: 'inherit', shell: true });

    process.emit('SIGTERM');
    expect(spawnSyncMock).toHaveBeenCalledWith(
      'taskkill',
      ['/pid', String(fakeChild.pid), '/T', '/F'],
      { stdio: 'ignore' }
    );
  });
});
