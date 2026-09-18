import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { detectAppSpec, detectFromFacts } from './index';
import type { ProjectFacts } from './facts';
import {
  isLockfileInSync,
  parseNodeMajor,
  parsePackageJsonWorkspaces,
  parsePackageManagerVersion,
  parsePnpmWorkspaceGlobs,
  parseProcfileWebCommand,
  parseReplitModules,
  parseViteOutDir,
  pnpmMajorFromLockfile,
} from './parsers';

/*
  Golden fixtures: one skeleton project per kind under __fixtures__/, with the
  spec and notes detection must produce checked in as expected.json. A change
  that alters detection for one kind fails that kind's test by name, which is
  what keeps origin-specific tweaks from quietly breaking everything else.
*/

const fixturesDir = join(__dirname, '__fixtures__');

describe('detectAppSpec fixtures', () => {
  for (const name of readdirSync(fixturesDir).sort()) {
    it(`detects ${name}`, async () => {
      const dir = join(fixturesDir, name);
      const expected = JSON.parse(readFileSync(join(dir, 'expected.json'), 'utf8'));
      const detected = await detectAppSpec(dir);
      expect(detected).toEqual(expected);
    });
  }
});

function facts(overrides: Partial<ProjectFacts>): ProjectFacts {
  return {
    cwd: '/project',
    packageJson: {},
    scripts: {},
    dependencies: {},
    packageManager: 'npm',
    lockfile: { present: false, inSync: false },
    hasModelenceConfig: false,
    hasIndexHtml: false,
    hasViteConfig: false,
    workspace: { globs: [], members: [] },
    ...overrides,
  };
}

describe('detectFromFacts', () => {
  it('asks for a choice when several workspace members can start', () => {
    const detected = detectFromFacts(
      facts({
        packageManager: 'pnpm',
        packageManagerVersion: '10',
        lockfile: { present: true, inSync: true },
        workspace: {
          globs: ['apps/*'],
          members: [
            {
              name: 'api',
              dir: 'apps/api',
              scripts: { start: 'node .' },
              dependencies: {},
              hasViteConfig: false,
            },
            {
              name: 'web',
              dir: 'apps/web',
              scripts: { start: 'node .' },
              dependencies: {},
              hasViteConfig: false,
            },
          ],
        },
      })
    );
    expect(detected.spec.web?.start).toBeUndefined();
    expect(detected.notes.join('\n')).toContain('api, web');
  });

  it('never applies a profile to a project it does not recognize', () => {
    const detected = detectFromFacts(facts({ scripts: { start: 'node server.js' } }));
    expect(detected.profile).toBeNull();
    expect(detected.spec).toEqual({
      build: { install: 'npm install' },
      web: { start: 'npm start' },
    });
  });

  it('mounts several Replit frontends at their folder names', () => {
    const detected = detectFromFacts(
      facts({
        packageManager: 'pnpm',
        packageManagerVersion: '10',
        lockfile: { present: true, inSync: true },
        replit: { modules: ['nodejs-24'] },
        workspace: {
          globs: ['artifacts/*'],
          members: [
            {
              name: '@workspace/api-server',
              dir: 'artifacts/api-server',
              scripts: { start: 'node .', build: 'node build.mjs' },
              dependencies: {},
              hasViteConfig: false,
            },
            {
              name: '@workspace/admin',
              dir: 'artifacts/admin',
              scripts: { build: 'vite build' },
              dependencies: {},
              hasViteConfig: true,
            },
            {
              name: '@workspace/shop',
              dir: 'artifacts/shop',
              scripts: { build: 'vite build' },
              dependencies: {},
              hasViteConfig: true,
              viteOutDir: 'out',
            },
          ],
        },
      })
    );
    expect(detected.profile).toBe('replit');
    expect(detected.spec.web?.static).toEqual([
      { path: '/admin', dir: 'artifacts/admin/dist/public' },
      { path: '/shop', dir: 'artifacts/shop/out' },
    ]);
    expect(detected.spec.build?.command).toBe(
      'pnpm --filter @workspace/api-server... --if-present run build && ' +
        'BASE_PATH=/admin pnpm --filter @workspace/admin run build && ' +
        'BASE_PATH=/shop pnpm --filter @workspace/shop run build'
    );
  });
});

describe('parsers', () => {
  it('parseNodeMajor takes the first major of a range and ignores unsupported ones', () => {
    expect(parseNodeMajor('>=20.10 <23')).toBe('20');
    expect(parseNodeMajor('22.x')).toBe('22');
    expect(parseNodeMajor('^16')).toBeUndefined();
    expect(parseNodeMajor(undefined)).toBeUndefined();
  });

  it('parseProcfileWebCommand reads the web line only', () => {
    expect(parseProcfileWebCommand('worker: node w.js\nweb: node server.js\n')).toBe(
      'node server.js'
    );
    expect(parseProcfileWebCommand('worker: node w.js')).toBeUndefined();
  });

  it('isLockfileInSync compares declared and locked dependencies both ways', () => {
    const packageJson = { dependencies: { a: '^1.0.0' }, devDependencies: { b: '^2.0.0' } };
    expect(
      isLockfileInSync(packageJson, {
        packages: { '': { dependencies: { a: '^1.0.0' }, devDependencies: { b: '^2.0.0' } } },
      })
    ).toBe(true);
    expect(
      isLockfileInSync(packageJson, { packages: { '': { dependencies: { a: '^1.0.0' } } } })
    ).toBe(false);
    expect(isLockfileInSync(packageJson, { lockfileVersion: 1 })).toBe(true);
  });

  it('parsePackageManagerVersion strips the integrity hash and ignores other managers', () => {
    expect(parsePackageManagerVersion('pnpm@10.4.1+sha512.abc', 'pnpm')).toBe('10.4.1');
    expect(parsePackageManagerVersion('yarn@4.1.0', 'pnpm')).toBeUndefined();
    expect(parsePackageManagerVersion('pnpm@latest', 'pnpm')).toBeUndefined();
  });

  it('pnpmMajorFromLockfile maps lockfile formats to a compatible major', () => {
    expect(pnpmMajorFromLockfile("lockfileVersion: '9.0'\n")).toBe(10);
    expect(pnpmMajorFromLockfile('lockfileVersion: "6.0"\n')).toBe(8);
    expect(pnpmMajorFromLockfile("lockfileVersion: '42.0'\n")).toBeUndefined();
  });

  it('workspace globs come from pnpm-workspace.yaml or package.json', () => {
    expect(
      parsePnpmWorkspaceGlobs(
        `packages:\n  - 'apps/*'\n  - "packages/**"\n  - '!packages/legacy' # old\nonlyBuiltDependencies:\n  - esbuild\n`
      )
    ).toEqual(['apps/*', 'packages/**', '!packages/legacy']);
    expect(parsePackageJsonWorkspaces({ workspaces: ['apps/*'] })).toEqual(['apps/*']);
    expect(parsePackageJsonWorkspaces({ workspaces: { packages: ['libs/*'] } })).toEqual([
      'libs/*',
    ]);
  });

  it('parseViteOutDir reads literal and path.resolve forms', () => {
    expect(parseViteOutDir('build: { outDir: "dist/public" }')).toBe('dist/public');
    expect(
      parseViteOutDir('outDir: path.resolve(import.meta.dirname, "dist/public"), emptyOutDir: true')
    ).toBe('dist/public');
    expect(parseViteOutDir("outDir: './out/'")).toBe('out');
    expect(parseViteOutDir('outDir: someVariable')).toBeUndefined();
  });

  it('parseReplitModules reads the modules list', () => {
    expect(parseReplitModules('modules = ["nodejs-24", "postgresql-16"]\n[deployment]\n')).toEqual([
      'nodejs-24',
      'postgresql-16',
    ]);
    expect(parseReplitModules('[deployment]\n')).toEqual([]);
  });
});
