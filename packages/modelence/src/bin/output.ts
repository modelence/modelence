import { stripVTControlCharacters } from 'util';

/*
  Logs and variables hold whatever the app or its visitors wrote, and escape
  sequences in them could rewrite the screen or reach the clipboard. Newlines
  and tabs stay.
*/
export function sanitizeForTerminal(text: string): string {
  return stripVTControlCharacters(text).replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '');
}

// The result of a command, on stdout; everything else goes to stderr.
export function printLine(line = ''): void {
  process.stdout.write(`${sanitizeForTerminal(line)}\n`);
}

export function printJson(data: unknown): void {
  printLine(JSON.stringify(data, null, 2));
}

export function printNote(line: string): void {
  process.stderr.write(`${sanitizeForTerminal(line)}\n`);
}

// Columns padded to their widest cell; the last one is left as it is.
export function formatTable(rows: string[][]): string[] {
  const widths = (rows[0] ?? []).map((_cell, column) =>
    Math.max(...rows.map((row) => row[column].length))
  );
  return rows.map((row) =>
    row
      .map((cell, column) => (column === row.length - 1 ? cell : cell.padEnd(widths[column])))
      .join('  ')
      .trimEnd()
  );
}

// A count given on the command line.
export function parseCount(value: string | undefined, name: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const count = Number(value);
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`${name} must be a whole number above 0, not "${value}".`);
  }
  return count;
}
