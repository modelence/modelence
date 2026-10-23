import { EventEmitter } from 'events';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

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
  loadEnv: vi.fn(),
}));

const readAppSpecFileMock = vi.fn();
const runDevCommandMock = vi.fn();

vi.mock('./appSpec', () => ({
  readAppSpecFile: (...args: unknown[]) => readAppSpecFileMock(...args),
}));

const loadLocalEnvMock = vi.fn();

vi.mock('./localEnv', () => ({
  loadLocalEnv: (...args: unknown[]) => loadLocalEnvMock(...args),
}));

vi.mock('./devScript', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./devScript')>();
  return { ...actual, runDevCommand: (...args: unknown[]) => runDevCommandMock(...args) };
});

class FakeChild extends EventEmitter {
  pid = 12345;
  killed = false;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
}

type Listener = (...args: unknown[]) => void;

describe('dev', () => {
  let sighupBefore: Listener[];
  let sigquitBefore: Listener[];
  let sigintBefore: Listener[];
  let sigtermBefore: Listener[];
  let exitBefore: Listener[];
  let killSpy: MockInstance<typeof process.kill>;
  let exitSpy: MockInstance<typeof process.exit>;
  let platformSpy: ReturnType<typeof vi.spyOn>;
  let fakeChild: FakeChild;

  const removeAddedListeners = (event: NodeJS.Signals | 'exit', before: Listener[]) => {
    const listeners = event === 'exit' ? process.listeners('exit') : process.listeners(event);
    for (const listener of listeners) {
      if (!before.includes(listener as Listener)) {
        process.removeListener(event, listener);
      }
    }
  };

  beforeEach(async () => {
    sighupBefore = process.listeners('SIGHUP') as Listener[];
    sigquitBefore = process.listeners('SIGQUIT') as Listener[];
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
    const { startFrameworkDevServer } = await import('./dev');
    startFrameworkDevServer({});
  });

  afterEach(() => {
    removeAddedListeners('SIGHUP', sighupBefore);
    removeAddedListeners('SIGQUIT', sigquitBefore);
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

  it('forwards SIGHUP to the whole child process group', () => {
    process.emit('SIGHUP');
    expect(killSpy).toHaveBeenCalledWith(-fakeChild.pid, 'SIGHUP');
  });

  it('forwards SIGQUIT to the whole child process group', () => {
    process.emit('SIGQUIT');
    expect(killSpy).toHaveBeenCalledWith(-fakeChild.pid, 'SIGQUIT');
  });

  it.each(['exitCode', 'signalCode'] as const)(
    'skips the Windows exit backstop when %s indicates the child exited',
    (field) => {
      platformSpy.mockReturnValue('win32');
      if (field === 'exitCode') {
        fakeChild.exitCode = 0;
      } else {
        fakeChild.signalCode = 'SIGTERM';
      }
      process.emit('exit', 0);
      expect(spawnSyncMock).not.toHaveBeenCalled();
    }
  );

  it('keeps the Windows exit backstop for a running child', () => {
    platformSpy.mockReturnValue('win32');
    process.emit('exit', 0);
    expect(spawnSyncMock).toHaveBeenCalledWith(
      'taskkill',
      ['/pid', String(fakeChild.pid), '/T', '/F'],
      { stdio: 'ignore' }
    );
  });

  it('keeps the POSIX exit backstop after the group leader exits', () => {
    fakeChild.exitCode = 0;
    process.emit('exit', 0);
    expect(killSpy).toHaveBeenCalledWith(-fakeChild.pid, 'SIGKILL');
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
    removeAddedListeners('SIGHUP', sighupBefore);
    removeAddedListeners('SIGQUIT', sigquitBefore);
    removeAddedListeners('SIGINT', sigintBefore);
    removeAddedListeners('SIGTERM', sigtermBefore);
    removeAddedListeners('exit', exitBefore);

    vi.resetModules();
    const { startFrameworkDevServer } = await import('./dev');
    startFrameworkDevServer({});

    expect(spawnMock).toHaveBeenCalledTimes(2);
    const [command, , options] = spawnMock.mock.calls[1];
    expect(command).toContain('tsx');
    expect(options).toMatchObject({ stdio: 'inherit', shell: true, detached: false });

    process.emit('SIGTERM');
    expect(spawnSyncMock).toHaveBeenCalledWith(
      'taskkill',
      ['/pid', String(fakeChild.pid), '/T', '/F'],
      { stdio: 'ignore' }
    );
  });
});

describe('dev routing', () => {
  let listenersBefore: Map<NodeJS.Signals | 'exit', Listener[]>;
  const events: (NodeJS.Signals | 'exit')[] = ['SIGHUP', 'SIGQUIT', 'SIGINT', 'SIGTERM', 'exit'];
  const listenersOf = (event: NodeJS.Signals | 'exit') =>
    (event === 'exit' ? process.listeners('exit') : process.listeners(event)) as Listener[];

  beforeEach(() => {
    listenersBefore = new Map(events.map((event) => [event, listenersOf(event)]));
    spawnMock.mockReset().mockReturnValue(new FakeChild());
    readAppSpecFileMock.mockReset().mockResolvedValue({ resources: {} });
    runDevCommandMock.mockReset();
    loadLocalEnvMock.mockReset();
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');
    vi.spyOn(process, 'kill').mockReturnValue(true);
    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    vi.resetModules();
  });

  afterEach(() => {
    for (const [event, before] of listenersBefore) {
      for (const listener of listenersOf(event)) {
        if (!before.includes(listener)) {
          process.removeListener(event, listener);
        }
      }
    }
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("runs the app's dev command", async () => {
    vi.stubEnv('MODELENCE_DEV_COMMAND', '');
    const { dev } = await import('./dev');
    await dev({}, ['--port', '4000'], '/app');

    expect(runDevCommandMock).toHaveBeenCalledWith(
      { resources: {} },
      ['--port', '4000'],
      '/app',
      {}
    );
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('starts the framework dev server when the dev command is `modelence dev`', async () => {
    vi.stubEnv('MODELENCE_DEV_COMMAND', '1');
    vi.stubEnv('DATABASE_URL', 'mongodb://merged');
    const { dev } = await import('./dev');
    await dev({}, [], '/app');

    expect(runDevCommandMock).not.toHaveBeenCalled();
    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [command, args, options] = spawnMock.mock.calls[0];
    expect(command).toContain('tsx');
    expect(args).toContain('watch');
    // It stays in the outer run's process group, which that run stops whole.
    expect(options.detached).toBeFalsy();
    expect(options.env).toMatchObject({
      DATABASE_URL: 'mongodb://merged',
      NODE_ENV: 'development',
    });
  });

  it('starts a legacy app on its own environment, without loading the connected one', async () => {
    readAppSpecFileMock.mockResolvedValue(null);
    vi.stubEnv('MODELENCE_DEV_COMMAND', '');
    vi.stubEnv('LOCAL_ONLY', 'kept');
    const { dev } = await import('./dev');
    await dev({}, [], '/app');

    expect(loadLocalEnvMock).not.toHaveBeenCalled();
    expect(runDevCommandMock).not.toHaveBeenCalled();
    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(spawnMock.mock.calls[0][2].env).toMatchObject({
      LOCAL_ONLY: 'kept',
      NODE_ENV: 'development',
    });
  });
});
