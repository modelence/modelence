import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { detectPackageManager, resolveScriptInvocation, withLocalBinPath } from './devScript';

describe('resolveScriptInvocation', () => {
  it('runs a package.json script through the package manager', () => {
    expect(resolveScriptInvocation('dev', [], 'pnpm')).toEqual({
      command: 'pnpm',
      args: ['run', 'dev'],
    });
  });

  it('separates script arguments with -- for npm only', () => {
    expect(resolveScriptInvocation('dev', ['--port', '4000'], 'npm')).toEqual({
      command: 'npm',
      args: ['run', 'dev', '--', '--port', '4000'],
    });
    expect(resolveScriptInvocation('dev', ['--port', '4000'], 'yarn')).toEqual({
      command: 'yarn',
      args: ['run', 'dev', '--port', '4000'],
    });
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
