import { describe, expect, it } from 'vitest';
import { planEnvPush } from './envPush';
import type { EnvDeclaration } from './appSpec';

const declarations: Record<string, EnvDeclaration> = {
  STRIPE_KEY: { type: 'secret' },
  VITE_URL: { scopes: ['build'] },
  DATABASE_URL: { type: 'resource', resource: 'main-db', output: 'url' },
};

describe('planEnvPush', () => {
  it('sends declared variables as the file declares them', () => {
    const { changes } = planEnvPush({ STRIPE_KEY: 'sk', VITE_URL: 'u' }, declarations, false);
    expect(changes).toEqual([
      { key: 'STRIPE_KEY', value: 'sk', declaration: { type: 'secret', scopes: undefined } },
      { key: 'VITE_URL', value: 'u', declaration: { type: undefined, scopes: ['build'] } },
    ]);
  });

  it('keeps undeclared variables local unless asked for all', () => {
    expect(planEnvPush({ DEBUG: '1' }, declarations, false)).toMatchObject({
      changes: [],
      skipped: [{ key: 'DEBUG', reason: expect.stringContaining('not declared') }],
    });
    expect(planEnvPush({ DEBUG: '1' }, declarations, true).changes).toEqual([
      { key: 'DEBUG', value: '1' },
    ]);
  });

  it.each([
    ['PORT', '3000', 'set by the platform'],
    ['MODELENCE_SERVICE_TOKEN', 't', 'set by the platform'],
    ['DATABASE_URL', 'postgres://local', 'comes from the resource "main-db"'],
    ['STRIPE_KEY', '', 'empty'],
  ])('never sends %s=%s', (key, value, reason) => {
    expect(planEnvPush({ [key]: value }, declarations, true)).toEqual({
      changes: [],
      skipped: [{ key, reason }],
    });
  });

  it('does not take an inherited name for a declaration', () => {
    expect(planEnvPush({ constructor: 'x' }, declarations, false).changes).toEqual([]);
  });

  it('never puts a value in what it reports as skipped', () => {
    const { skipped } = planEnvPush({ DEBUG: 'hunter22', PORT: 'hunter33' }, declarations, false);
    expect(JSON.stringify(skipped)).not.toContain('hunter');
  });
});
