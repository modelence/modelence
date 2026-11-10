import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import {
  detectPackageManager,
  quoteShellArg,
  resolveCommandsInvocation,
  resolveDevTarget,
  resolveScriptInvocation,
  withLocalBinPath,
} from './devScript';

describe('resolveScriptInvocation', () => {
  it('runs a package.json script through the package manager', () => {
    expect(resolveScriptInvocation('dev', [], 'pnpm', 'linux')).toEqual({
      command: 'pnpm',
      args: ['run', 'dev'],
      shell: false,
    });
  });

  it('separates script arguments with -- for npm only', () => {
    expect(resolveScriptInvocation('dev', ['--port', '4000'], 'npm', 'linux').args).toEqual([
      'run',
      'dev',
      '--',
      '--port',
      '4000',
    ]);
    expect(resolveScriptInvocation('dev', ['--port', '4000'], 'yarn', 'linux').args).toEqual([
      'run',
      'dev',
      '--port',
      '4000',
    ]);
  });

  it('runs the package manager through a shell on Windows', () => {
    expect(resolveScriptInvocation('dev', [], 'npm', 'win32').shell).toBe(true);
  });
});

describe('resolveCommandsInvocation', () => {
  it('chains the commands in one shell and passes arguments to the last', () => {
    expect(
      resolveCommandsInvocation(['prisma generate', 'next dev'], ['--port', '4000'], 'linux')
    ).toEqual({
      command: 'prisma generate && next dev --port 4000',
      args: [],
      shell: true,
    });
  });
});

describe('quoteShellArg', () => {
  it('leaves plain words alone', () => {
    expect(quoteShellArg('--port=4000', 'linux')).toBe('--port=4000');
  });

  it('quotes for sh', () => {
    expect(quoteShellArg("it's here", 'linux')).toBe("'it'\\''s here'");
  });

  it('quotes for cmd.exe', () => {
    expect(quoteShellArg('say "hi"', 'win32')).toBe('"say ""hi"""');
  });
});

describe('withLocalBinPath', () => {
  const binDir = join('/app', 'node_modules', '.bin');

  it('prepends the local bin directory to PATH', () => {
    expect(withLocalBinPath({ PATH: '/usr/bin' }, '/app')).toEqual({
      PATH: `${binDir}${delimiter}/usr/bin`,
    });
  });

  it('keeps the Windows `Path` key instead of adding a second PATH', () => {
    expect(withLocalBinPath({ Path: 'C:\\Windows' }, '/app')).toEqual({
      Path: `${binDir}${delimiter}C:\\Windows`,
    });
  });

  it('sets PATH to the bin directory when there is none', () => {
    expect(withLocalBinPath({}, '/app')).toEqual({ PATH: binDir });
  });
});

describe('detectPackageManager', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'modelence-dev-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('defaults to npm without a lockfile', () => {
    expect(detectPackageManager(root)).toBe('npm');
  });

  it('follows the lockfile', async () => {
    await writeFile(join(root, 'pnpm-lock.yaml'), '');
    expect(detectPackageManager(root)).toBe('pnpm');
  });

  it('finds the lockfile of an enclosing workspace', async () => {
    const app = join(root, 'apps', 'web');
    await mkdir(app, { recursive: true });
    await writeFile(join(root, 'yarn.lock'), '');
    expect(detectPackageManager(app)).toBe('yarn');
  });

  it('prefers the packageManager field over lockfiles', async () => {
    await writeFile(join(root, 'package-lock.json'), '{}');
    await writeFile(join(root, 'package.json'), JSON.stringify({ packageManager: 'bun@1.1.0' }));
    expect(detectPackageManager(root)).toBe('bun');
  });
});

describe('resolveDevTarget', () => {
  let root: string;

  beforeEach(async () => {
    // resolveAppRoot returns real paths; macOS puts tmpdir behind a symlink.
    root = await realpath(await mkdtemp(join(tmpdir(), 'modelence-dev-')));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("runs the service's dev commands in its root", async () => {
    await mkdir(join(root, 'apps', 'web'), { recursive: true });
    const spec = {
      resources: {
        web: { type: 'service' as const, root: 'apps/web', dev: { commands: ['next dev'] } },
      },
    };
    expect(await resolveDevTarget(spec, root)).toEqual({
      kind: 'commands',
      commands: ['next dev'],
      root: join(root, 'apps', 'web'),
    });
  });

  it('falls back to the package.json dev script in the service root', async () => {
    const spec = { resources: { app: { type: 'service' as const } } };
    expect(await resolveDevTarget(spec, root)).toEqual({ kind: 'script', root });
  });

  it('falls back to the project root without a service', async () => {
    expect(await resolveDevTarget({}, root)).toEqual({ kind: 'script', root });
  });

  it('rejects an empty dev command list', async () => {
    const spec = { resources: { app: { type: 'service' as const, dev: { commands: [] } } } };
    await expect(resolveDevTarget(spec, root)).rejects.toThrow(
      '"resources.app.dev.commands" must list at least one command'
    );
  });

  it('rejects a malformed dev section', async () => {
    const spec = { resources: { app: { type: 'service', dev: 'next dev' } } };
    await expect(resolveDevTarget(spec as never, root)).rejects.toThrow(
      '"resources.app.dev" must be an object with a "commands" array'
    );
  });

  it('runs only one service', async () => {
    const spec = {
      resources: { api: { type: 'service' as const }, web: { type: 'service' as const } },
    };
    await expect(resolveDevTarget(spec, root)).rejects.toThrow('more than one service');
  });
});
