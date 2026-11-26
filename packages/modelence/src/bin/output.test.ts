import { describe, expect, it } from 'vitest';
import { formatTable, parseCount, sanitizeForTerminal } from './output';

describe('sanitizeForTerminal', () => {
  it('removes escape sequences and control characters, keeping lines and tabs', () => {
    expect(sanitizeForTerminal('\u001b[31mred\u001b[0m\tok\nnext')).toBe('red\tok\nnext');
    const hostile = sanitizeForTerminal('a\u001b]52;c;aGk=\u0007b\u001b[2Jc\rd\u009b2Je\u0008');

    expect(hostile).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/);
  });

  it('leaves JSON intact', () => {
    const json = JSON.stringify({ message: '\u001b[31mred' }, null, 2);
    expect(JSON.parse(sanitizeForTerminal(json))).toEqual({ message: '\u001b[31mred' });
  });
});

describe('formatTable', () => {
  it('pads every column but the last', () => {
    expect(
      formatTable([
        ['A', 'B'],
        ['long', 'x'],
      ])
    ).toEqual(['A     B', 'long  x']);
  });
});

describe('parseCount', () => {
  it('takes whole numbers above 0', () => {
    expect(parseCount('5', '--lines')).toBe(5);
    expect(parseCount(undefined, '--lines')).toBeUndefined();
    for (const value of ['0', '-1', '1.5', 'x', '']) {
      expect(() => parseCount(value, '--lines')).toThrow('--lines must be');
    }
  });
});
