import { describe, expect, it } from 'vitest';
import { readWebSpec, WEB_SPEC_ENV_NAME } from './spec';

describe('readWebSpec', () => {
  it('reads the web spec from the environment', () => {
    expect(
      readWebSpec({ [WEB_SPEC_ENV_NAME]: '{"start":null,"static":[{"path":"/","dir":"dist"}]}' })
    ).toEqual({ start: null, static: [{ path: '/', dir: 'dist' }] });
  });

  it('treats a missing, invalid or empty start as no process', () => {
    expect(readWebSpec({})).toBeNull();
    expect(readWebSpec({ [WEB_SPEC_ENV_NAME]: 'nope' })).toBeNull();
    expect(readWebSpec({ [WEB_SPEC_ENV_NAME]: '{"start":""}' })).toEqual({
      start: null,
      static: [],
    });
  });
});
