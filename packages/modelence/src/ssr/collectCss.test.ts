import { describe, test, expect } from '@jest/globals';
import { renderStylesheetLinks, buildEarlyHintsLink, type CssAssets } from './collectCss';

describe('renderStylesheetLinks', () => {
  test('emits a <link rel="stylesheet"> tag for every asset', () => {
    const assets: CssAssets = {
      hrefs: ['/src/index.css', '/assets/theme-abc.css'],
      source: 'dev',
    };
    const html = renderStylesheetLinks(assets);
    expect(html).toContain('<link rel="stylesheet" href="/src/index.css">');
    expect(html).toContain('<link rel="stylesheet" href="/assets/theme-abc.css">');
  });

  test('returns empty string for no assets', () => {
    expect(renderStylesheetLinks({ hrefs: [], source: 'dev' })).toBe('');
  });

  test('HTML-escapes & and " in hrefs to prevent attribute injection', () => {
    const assets: CssAssets = {
      hrefs: ['/x.css?a=1&b=2', '/oops".css'],
      source: 'dev',
    };
    const html = renderStylesheetLinks(assets);
    expect(html).toContain('href="/x.css?a=1&amp;b=2"');
    expect(html).toContain('href="/oops&quot;.css"');
    // Critically — no raw quote that would close the attribute.
    expect(html).not.toContain('oops".css');
  });
});

describe('buildEarlyHintsLink', () => {
  test('formats each asset as an RFC 8288 Link value', () => {
    const links = buildEarlyHintsLink({
      hrefs: ['/a.css', '/b.css'],
      source: 'prod',
    });
    expect(links).toEqual(['</a.css>; rel=preload; as=style', '</b.css>; rel=preload; as=style']);
  });

  test('returns empty array for no assets', () => {
    expect(buildEarlyHintsLink({ hrefs: [], source: 'dev' })).toEqual([]);
  });
});
