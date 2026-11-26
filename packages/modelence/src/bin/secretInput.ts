import { createInterface } from 'readline';
import { Writable } from 'stream';

// Ways a value reaches the CLI without being in its arguments or its output.

// All of stdin, without the newline that echo and most tools end with.
export async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks)
    .toString('utf8')
    .replace(/\r?\n$/, '');
}

// A prompt that doesn't echo what is typed. Only for a real terminal.
export async function promptHidden(question: string): Promise<string> {
  const muted = new Writable({ write: (_chunk, _encoding, done) => done() });
  const prompt = createInterface({ input: process.stdin, output: muted, terminal: true });
  process.stderr.write(question);
  try {
    return await new Promise<string>((resolve, reject) => {
      prompt.once('SIGINT', () => reject(new Error('Cancelled.')));
      prompt.once('close', () => reject(new Error('Cancelled.')));
      prompt.question('', resolve);
    });
  } finally {
    prompt.close();
    process.stderr.write('\n');
  }
}
