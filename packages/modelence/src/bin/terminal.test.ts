import { PassThrough } from 'stream';
import { describe, expect, it, vi } from 'vitest';
import { ask } from './terminal';

function fakeTerminal() {
  const input = Object.assign(new PassThrough(), {
    isRaw: false,
    setRawMode: vi.fn(),
  });
  let written = '';
  const output = {
    write: (text: string) => {
      written += text;
      return true;
    },
  };
  return { input, output, written: () => written };
}

describe('ask, for a secret', () => {
  // A readline redraw after a backspace used to print the value in clear.
  it('never echoes what is typed, through edits included', async () => {
    const terminal = fakeTerminal();
    const answer = ask('  TOKEN (secret): ', { secret: true, ...terminal });
    terminal.input.write('hunter2');
    terminal.input.write('\u007f');
    terminal.input.write('X');
    terminal.input.write('\r');

    expect(await answer).toBe('hunterX');
    expect(terminal.written()).not.toMatch(/hunter|X/);
    expect(terminal.written()).toBe('  TOKEN (secret): *******\b \b*\n');
    expect(terminal.input.setRawMode).toHaveBeenLastCalledWith(false);
  });

  it('takes a pasted value up to its line break, ignoring arrow keys', async () => {
    const terminal = fakeTerminal();
    const answer = ask('key: ', { secret: true, ...terminal });
    terminal.input.write('\u001b[D');
    terminal.input.write('mongodb://user:pass@host\r\n');
    expect(await answer).toBe('mongodb://user:pass@host');
    expect(terminal.written()).not.toContain('pass');
  });

  it('stops on Ctrl+C', async () => {
    const terminal = fakeTerminal();
    const answer = ask('key: ', { secret: true, ...terminal });
    terminal.input.write('abc\u0003');
    await expect(answer).rejects.toThrow('Cancelled');
    expect(terminal.input.setRawMode).toHaveBeenLastCalledWith(false);
  });
});
