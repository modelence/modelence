import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { init } from './init';
import { AGENT_SETUP_PROMPT, APP_SPEC_SCHEMA_URL } from './appSpec';

let dir: string;
let logged: string[];

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'modelence-init-'));
  logged = [];
  vi.spyOn(process, 'cwd').mockReturnValue(dir);
  vi.spyOn(console, 'log').mockImplementation((line: string) => {
    logged.push(line);
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

describe('init', () => {
  // VS Code only downloads schemas from trusted hosts, raw GitHub among them.
  it('writes the template with the GitHub-hosted schema and prints the agent prompt', async () => {
    await init({});
    expect(JSON.parse(await readFile(join(dir, 'modelence.config.json'), 'utf8'))).toEqual({
      $schema:
        'https://raw.githubusercontent.com/modelence/modelence/main/schema/v1/modelence.config.json',
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

  it('refuses to overwrite an existing file unless forced', async () => {
    await writeFile(join(dir, 'modelence.config.json'), '{ "web": { "start": "node ." } }');
    await expect(init({})).rejects.toThrow('already exists');
    await init({ force: true });
    const written = JSON.parse(await readFile(join(dir, 'modelence.config.json'), 'utf8'));
    expect(written.$schema).toBe(APP_SPEC_SCHEMA_URL);
    expect(written.resources.app.type).toBe('service');
  });
});
