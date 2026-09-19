import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { prepareSpec } from './deploySpec';
import { formatAppSpec, readAppSpecFile } from './appSpec';
import { resolveAppRoot } from './appRoot';
import { resolveTargetFromOptions } from './deployTarget';

let dir: string;
let logged: string[];
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'modelence-plan-'));
  logged = [];
  vi.spyOn(console, 'log').mockImplementation((line: string) => {
    logged.push(line);
  });
  await mkdir(join(dir, 'apps/api'), { recursive: true });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

describe('modelence.json presence', () => {
  it('fails with the agent prompt when the file is missing', async () => {
    await expect(prepareSpec(dir)).rejects.toThrow(
      [
        `modelence.json not found in ${dir}.`,
        'Modelence Cloud builds and runs your app exactly as this file describes (install, build and start commands, Node.js version, static directories).',
        'Ask your coding agent to create it with this prompt:',
        '',
        '  Use https://docs.modelence.com/deploy/setup.md to set up Modelence deployment for this project',
        '',
        'Reference: https://docs.modelence.com/deploy/setup',
      ].join('\n')
    );
  });

  it('returns the file as written and prints the plan', async () => {
    const spec = {
      build: { install: 'npm ci', command: 'npm run build' },
      web: { start: 'node .' },
    };
    await writeFile(join(dir, 'modelence.json'), JSON.stringify(spec));
    expect(await prepareSpec(dir)).toEqual(spec);
    expect(logged[0]).toBe('Build plan (modelence.json):');
    expect(logged).toContain('  build:   npm run build');
    expect(logged).toContain('  start:   node .');
  });
});

describe('modelence.json parsing', () => {
  it('accepts comments and trailing commas', async () => {
    await writeFile(
      join(dir, 'modelence.json'),
      `{
        // Built by Vite, served by the platform.
        "build": { "command": "npm run build", /* no server */ },
        "web": { "start": null, "static": [{ "path": "/", "dir": "dist" },], },
      }`
    );
    expect(await readAppSpecFile(dir)).toEqual({
      build: { command: 'npm run build' },
      web: { start: null, static: [{ path: '/', dir: 'dist' }] },
    });
  });

  it('reports the position of malformed JSON', async () => {
    await writeFile(join(dir, 'modelence.json'), '{\n  "build": { "node": 22 "x" }\n}');
    await expect(readAppSpecFile(dir)).rejects.toThrow(/not valid JSON: .* at line 2/);
  });

  it('rejects anything that is not an object', async () => {
    await writeFile(join(dir, 'modelence.json'), '["node"]');
    await expect(readAppSpecFile(dir)).rejects.toThrow('must contain a JSON object');
  });

  it('rejects unknown top-level keys by name', async () => {
    await writeFile(join(dir, 'modelence.json'), JSON.stringify({ builds: {}, web: {} }));
    await expect(prepareSpec(dir)).rejects.toThrow('unknown key "builds"');
  });

  it('rejects sections that are not objects', async () => {
    await writeFile(join(dir, 'modelence.json'), JSON.stringify({ web: ['node .'] }));
    await expect(prepareSpec(dir)).rejects.toThrow('"web" must be an object');
  });
});

describe('build.root', () => {
  it('accepts a subdirectory inside the project', async () => {
    await writeFile(join(dir, 'modelence.json'), JSON.stringify({ build: { root: 'apps/api' } }));
    expect((await prepareSpec(dir)).build?.root).toBe('apps/api');
    expect(logged).toContain('  root:    apps/api');
  });

  it('rejects a directory that does not exist', async () => {
    await writeFile(join(dir, 'modelence.json'), JSON.stringify({ build: { root: 'missing' } }));
    await expect(prepareSpec(dir)).rejects.toThrow('build.root "missing" does not exist');
  });

  it('rejects a file', async () => {
    await writeFile(join(dir, 'apps/api/index.js'), '');
    await expect(resolveAppRoot(dir, 'apps/api/index.js')).rejects.toThrow('must be a directory');
  });

  it('rejects traversal, absolute paths and symlinks outside the uploaded tree', async () => {
    await expect(resolveAppRoot(dir, '..')).rejects.toThrow('inside the project');
    await expect(resolveAppRoot(dir, tmpdir())).rejects.toThrow('relative directory');
    await symlink(tmpdir(), join(dir, 'outside'));
    await expect(resolveAppRoot(dir, 'outside')).rejects.toThrow('inside the project');
  });
});

describe('plan formatting', () => {
  it('prints null commands as none and missing ones as default', () => {
    const lines = formatAppSpec({ build: { command: null }, web: { start: null } });
    expect(lines).toContain('  build:   (none)');
    expect(lines).toContain('  start:   (none)');
    expect(formatAppSpec({})).toEqual([
      '  runtime: node',
      '  node:    default (22)',
      '  install: default',
      '  build:   default',
      '  start:   default',
    ]);
  });

  it('lists environment variables and static mounts', () => {
    const lines = formatAppSpec({
      runtime: 'node',
      build: { node: '20', env: { VITE_BASE: '/' } },
      web: { start: 'node server.js', static: [{ path: '/', dir: 'client/dist' }] },
    });
    expect(lines).toContain('  node:    20');
    expect(lines).toContain('  env:     VITE_BASE=/');
    expect(lines).toContain('  static:  / -> client/dist/');
  });
});

describe('deploy target precedence', () => {
  const project = {
    appId: 'app-id',
    deploy: { environmentId: 'saved-env', appAlias: 'saved-app', envAlias: 'prod' },
  };
  it('uses explicit aliases before the saved target', () => {
    expect(resolveTargetFromOptions({ app: 'other', env: 'staging' }, project)).toEqual({
      appAlias: 'other',
      envAlias: 'staging',
    });
    expect(resolveTargetFromOptions({ env: 'staging' }, project)).toEqual({
      appAlias: 'saved-app',
      envAlias: 'staging',
    });
    expect(resolveTargetFromOptions({}, project)).toEqual({ environmentId: 'saved-env' });
    expect(resolveTargetFromOptions({}, {})).toBeNull();
    expect(() => resolveTargetFromOptions({ app: 'other' }, project)).toThrow('Pass both');
  });
});
