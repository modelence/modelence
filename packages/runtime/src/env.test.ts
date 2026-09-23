import { describe, expect, it } from 'vitest';
import { mergeRuntimeEnv } from './env';

describe('mergeRuntimeEnv', () => {
  it('lets the environment override the image except for the platform names', () => {
    const remote = {
      PORT: '8080',
      MODELENCE_WEB: 'tampered',
      NODE_OPTIONS: '--max-old-space-size=512',
      GREETING: 'hello',
      EMPTY: null,
    };
    const existing = { PORT: '3000', MODELENCE_WEB: 'spec', NODE_OPTIONS: '--enable-source-maps' };
    expect(mergeRuntimeEnv(remote, existing)).toEqual({
      PORT: '3000',
      MODELENCE_WEB: 'spec',
      NODE_OPTIONS: '--max-old-space-size=512',
      GREETING: 'hello',
    });
  });

  it('leaves the existing environment untouched', () => {
    const existing = { GREETING: 'image' };
    mergeRuntimeEnv({ GREETING: 'dashboard' }, existing);
    expect(existing).toEqual({ GREETING: 'image' });
  });
});
