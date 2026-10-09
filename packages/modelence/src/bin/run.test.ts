import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectPackageManager, resolveInvocation } from './run';

describe('resolveInvocation', () => {
  const scripts = { dev: 'next dev' };

  it('runs a package.json script through the package manager', () => {
    expect(resolveInvocation('dev', [], scripts, 'pnpm')).toEqual({
      command: 'pnpm',
      args: ['run', 'dev'],
    });
  });

  it('separates script arguments with -- for npm only', () => {
    expect(resolveInvocation('dev', ['--port', '4000'], scripts, 'npm')).toEqual({
      command: 'npm',
      args: ['run', 'dev', '--', '--port', '4000'],
    });
    expect(resolveInvocation('dev', ['--port', '4000'], scripts, 'yarn')).toEqual({
      command: 'yarn',
      args: ['run', 'dev', '--port', '4000'],
    });
  });

  it('runs anything that is not a script as a command', () => {
    expect(resolveInvocation('next', ['dev'], scripts, 'npm')).toEqual({
      command: 'next',
      args: ['dev'],
    });
  });

  it('does not treat inherited object keys as scripts', () => {
    expect(resolveInvocation('toString', [], scripts, 'npm')).toEqual({
      command: 'toString',
      args: [],
    });
  });
});

describe('detectPackageManager', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'modelence-run-'));
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
