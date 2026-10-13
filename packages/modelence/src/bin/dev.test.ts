import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isFrameworkApp } from './dev';

describe('isFrameworkApp', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'modelence-dev-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('is a framework app with a modelence.config.ts', async () => {
    await writeFile(join(root, 'modelence.config.ts'), 'export default {};');
    expect(isFrameworkApp(root)).toBe(true);
  });

  it('is not one that only depends on the modelence package', async () => {
    await writeFile(
      join(root, 'package.json'),
      JSON.stringify({ scripts: { dev: 'next dev' }, devDependencies: { modelence: '*' } })
    );
    expect(isFrameworkApp(root)).toBe(false);
  });
});
