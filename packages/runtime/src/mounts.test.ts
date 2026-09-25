import { describe, expect, it } from 'vitest';
import { matchMount, stripMountPrefix } from './mounts';

describe('mount matching', () => {
  it('picks the longest matching prefix and strips it', () => {
    const mounts = [{ path: '/' }, { path: '/docs' }, { path: '/docs/api' }];
    const result = ['/', '/about', '/docs', '/docs/', '/docs/intro', '/docs/api/x', '/docsx'].map(
      (urlPath) => {
        const mount = matchMount(mounts, urlPath);
        return `${mount?.path} ${stripMountPrefix(mount?.path ?? '/', urlPath)}`;
      }
    );
    expect(result).toEqual([
      '/ /',
      '/ /about',
      '/docs /',
      '/docs /',
      '/docs /intro',
      '/docs/api /x',
      '/ /docsx',
    ]);
    expect(matchMount([{ path: '/docs' }], '/about')).toBeNull();
  });
});
