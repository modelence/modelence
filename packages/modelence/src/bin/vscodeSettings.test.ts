import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'jsonc-parser';
import { getSchemaHost, isKnownSchemaHost, trustSchemaHost } from './vscodeSettings';

const SETTING = 'json.schemaDownload.trustedDomains';
let dir: string;
const settingsPath = () => join(dir, '.vscode', 'settings.json');
const readSettings = async () => parse(await readFile(settingsPath(), 'utf8'));

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'modelence-vscode-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('trustSchemaHost', () => {
  it('creates the settings file when asked to', async () => {
    expect(await trustSchemaHost(dir, 'https://cloud.modelence.com', { create: true })).toBe(
      'added'
    );
    expect(await readSettings()).toEqual({
      [SETTING]: { 'https://cloud.modelence.com/': true },
    });
  });

  // `deploy` only adds to a VS Code setup the project already has.
  it('leaves a project without .vscode alone unless asked to create it', async () => {
    expect(await trustSchemaHost(dir, 'https://cloud.modelence.com', { create: false })).toBe(
      'skipped'
    );
    await expect(readFile(settingsPath(), 'utf8')).rejects.toThrow();
  });

  it('merges into existing settings, keeping comments and other trusted domains', async () => {
    await mkdir(join(dir, '.vscode'));
    await writeFile(
      settingsPath(),
      `{
  // Team formatting
  "editor.tabSize": 2,
  "${SETTING}": { "https://example.com/": true },
}
`
    );
    expect(await trustSchemaHost(dir, 'https://cloud.modelence.com/', { create: false })).toBe(
      'added'
    );
    const content = await readFile(settingsPath(), 'utf8');
    expect(content).toContain('// Team formatting');
    expect(parse(content)).toEqual({
      'editor.tabSize': 2,
      [SETTING]: { 'https://example.com/': true, 'https://cloud.modelence.com/': true },
    });
  });

  it('does nothing when the host is already trusted', async () => {
    await mkdir(join(dir, '.vscode'));
    const content = `{ "${SETTING}": { "https://cloud.modelence.com/": true } }\n`;
    await writeFile(settingsPath(), content);
    expect(await trustSchemaHost(dir, 'https://cloud.modelence.com', { create: true })).toBe(
      'present'
    );
    expect(await readFile(settingsPath(), 'utf8')).toBe(content);
  });

  it('never rewrites a settings file it cannot parse', async () => {
    await mkdir(join(dir, '.vscode'));
    await writeFile(settingsPath(), '{ "editor.tabSize": ');
    expect(await trustSchemaHost(dir, 'https://cloud.modelence.com', { create: true })).toBe(
      'skipped'
    );
    expect(await readFile(settingsPath(), 'utf8')).toBe('{ "editor.tabSize": ');
  });
});

describe('getSchemaHost', () => {
  it('reads the host, with any path prefix, from a Modelence schema URL', () => {
    expect(
      getSchemaHost('https://cloud.modelence.com/schema/modelence.config.json?version=1')
    ).toBe('https://cloud.modelence.com');
    expect(getSchemaHost('https://corp.example/studio/schema/modelence.config.json')).toBe(
      'https://corp.example/studio'
    );
    expect(getSchemaHost('https://example.com/other.json')).toBeNull();
    expect(getSchemaHost('hayk.modelence.dev/schema/modelence.config.json')).toBeNull();
  });
});

describe('isKnownSchemaHost', () => {
  it('accepts the deploy host and Modelence hosts only', () => {
    expect(isKnownSchemaHost('https://corp.example', 'https://corp.example')).toBe(true);
    expect(isKnownSchemaHost('https://cloud.modelence.com', 'https://corp.example')).toBe(true);
    expect(isKnownSchemaHost('https://hayk.modelence.dev', 'https://corp.example')).toBe(true);
    expect(isKnownSchemaHost('http://localhost:3000', 'https://corp.example')).toBe(true);
    expect(isKnownSchemaHost('https://attacker.example', 'https://corp.example')).toBe(false);
    expect(isKnownSchemaHost('https://modelence.dev.attacker.example', 'https://x.example')).toBe(
      false
    );
  });
});
