import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { init } from './init';
import { AGENT_SETUP_PROMPT } from './appSpec';

let dir: string;
let logged: string[];

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'modelence-init-'));
  logged = [];
  vi.spyOn(process, 'cwd').mockReturnValue(dir);
  vi.stubEnv('MODELENCE_SERVICE_ENDPOINT', '');
  vi.spyOn(console, 'log').mockImplementation((line: string) => {
    logged.push(line);
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});

describe('init', () => {
  it('writes the template with the schema of the given host and prints the agent prompt', async () => {
    await init({ host: 'https://studio.example/' });
    expect(JSON.parse(await readFile(join(dir, 'modelence.config.json'), 'utf8'))).toEqual({
      $schema: 'https://studio.example/schema/modelence.config.json?version=1',
      resources: {
        app: {
          type: 'service',
          image: 'node-22-slim',
          build: { commands: ['npm ci'] },
          static: [],
        },
      },
      env: {},
    });
    expect(logged).toContain(`  ${AGENT_SETUP_PROMPT}`);
    expect(logged.at(-1)).toContain('npx modelence@latest deploy');
  });

  // Studio refuses a $schema that is not a URL.
  it('writes a full URL for a bare host name', async () => {
    await init({ host: 'hayk.modelence.dev' });
    const written = JSON.parse(await readFile(join(dir, 'modelence.config.json'), 'utf8'));
    expect(written.$schema).toBe(
      'https://hayk.modelence.dev/schema/modelence.config.json?version=1'
    );
  });

  it('uses the host deploy would use when none is given', async () => {
    await writeFile(join(dir, '.modelence.env'), 'MODELENCE_SERVICE_ENDPOINT=hayk.modelence.dev\n');
    await init({});
    const written = JSON.parse(await readFile(join(dir, 'modelence.config.json'), 'utf8'));
    expect(written.$schema).toBe(
      'https://hayk.modelence.dev/schema/modelence.config.json?version=1'
    );
  });

  it('refuses to overwrite an existing file unless forced', async () => {
    await writeFile(join(dir, 'modelence.config.json'), '{ "web": { "start": "node ." } }');
    await expect(init({})).rejects.toThrow('already exists');
    await init({ force: true });
    const written = JSON.parse(await readFile(join(dir, 'modelence.config.json'), 'utf8'));
    expect(written.$schema).toBe(
      'https://cloud.modelence.com/schema/modelence.config.json?version=1'
    );
    expect(written.resources.app.type).toBe('service');
  });
});
