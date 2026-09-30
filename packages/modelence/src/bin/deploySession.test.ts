import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeHost, resolveHost } from './deploySession';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('normalizeHost', () => {
  it('adds https:// to a bare host name and drops a trailing slash', () => {
    expect(normalizeHost('hayk.modelence.dev')).toBe('https://hayk.modelence.dev');
    expect(normalizeHost('hayk.modelence.dev/')).toBe('https://hayk.modelence.dev');
  });

  it('keeps an explicit scheme', () => {
    expect(normalizeHost('http://localhost:3000/')).toBe('http://localhost:3000');
    expect(normalizeHost('https://cloud.modelence.com')).toBe('https://cloud.modelence.com');
  });

  it('refuses something that is not a host', () => {
    expect(() => normalizeHost('not a host')).toThrow('Invalid Modelence host');
  });

  // An unknown scheme parses, with the origin "null".
  it('refuses a scheme other than http and https', () => {
    expect(() => normalizeHost('htps://cloud.modelence.com')).toThrow('Invalid Modelence host');
    expect(() => normalizeHost('ftp://cloud.modelence.com')).toThrow('Invalid Modelence host');
  });

  it('keeps the path of a Studio served under a prefix', () => {
    expect(normalizeHost('https://corp.example/studio/')).toBe('https://corp.example/studio');
  });
});

describe('resolveHost', () => {
  it('normalizes the host from every source', async () => {
    expect(await resolveHost('hayk.modelence.dev', '/nonexistent')).toBe(
      'https://hayk.modelence.dev'
    );

    vi.stubEnv('MODELENCE_SERVICE_ENDPOINT', 'hayk.modelence.dev');
    expect(await resolveHost(undefined, '/nonexistent')).toBe('https://hayk.modelence.dev');
    vi.unstubAllEnvs();

    const dir = await mkdtemp(join(tmpdir(), 'modelence-host-'));
    try {
      vi.stubEnv('MODELENCE_SERVICE_ENDPOINT', '');
      await writeFile(
        join(dir, '.modelence.env'),
        'MODELENCE_SERVICE_ENDPOINT=hayk.modelence.dev\n'
      );
      expect(await resolveHost(undefined, dir)).toBe('https://hayk.modelence.dev');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
