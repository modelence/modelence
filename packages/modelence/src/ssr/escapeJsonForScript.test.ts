import { describe, test, expect } from 'vitest';
import { escapeJsonForScript } from '../viteServer';

describe('escapeJsonForScript', () => {
  test('escapes </script> so embedded JSON cannot break out', () => {
    const json = JSON.stringify({ payload: '</script><script>alert(1)</script>' });
    const escaped = escapeJsonForScript(json);
    expect(escaped).not.toContain('</script>');
    expect(escaped).not.toContain('<script>');
    // Round-trip still parses to the original payload.
    expect(JSON.parse(escaped)).toEqual(JSON.parse(json));
  });

  test('escapes <, >, and & to their unicode forms', () => {
    const escaped = escapeJsonForScript('<>&');
    expect(escaped).toBe('\\u003c\\u003e\\u0026');
  });

  test('escapes U+2028 and U+2029 (illegal in JS source strings)', () => {
    const escaped = escapeJsonForScript('  ');
    expect(escaped).toBe('\\u2028\\u2029');
  });

  test('leaves safe characters untouched', () => {
    const safe = '{"name":"Alice","items":[1,2,3]}';
    expect(escapeJsonForScript(safe)).toBe(safe);
  });

  test('does not double-escape pre-escaped sequences', () => {
    // The single-pass replace must not re-process the backslash it just wrote.
    const escaped = escapeJsonForScript('<<<');
    expect(escaped).toBe('\\u003c\\u003c\\u003c');
    // Round-trip via JSON keeps strings intact.
    const json = JSON.stringify({ s: '<<<' });
    expect(JSON.parse(escapeJsonForScript(json))).toEqual({ s: '<<<' });
  });

  test('handles HTML-injection vectors inside JSON string values', () => {
    const json = JSON.stringify({
      a: '<img src=x onerror=alert(1)>',
      b: '&lt;already-escaped&gt;',
    });
    const escaped = escapeJsonForScript(json);
    expect(escaped).not.toMatch(/<|>|&/);
    expect(JSON.parse(escaped)).toEqual(JSON.parse(json));
  });
});
