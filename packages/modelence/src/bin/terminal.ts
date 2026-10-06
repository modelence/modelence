import { createInterface } from 'readline';

/*
  Whether someone is at the terminal to answer a question or approve a
  sign-in in the browser. CI runners, GitHub Actions and agent sandboxes set
  CI or run without a TTY; waiting on them would only hang until a timeout.
*/
export function isInteractive(): boolean {
  return !process.env.CI && Boolean(process.stdin.isTTY);
}

export async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolve) => rl.question(`${question} (y/N) `, resolve));
  rl.close();
  return answer.trim().toLowerCase() === 'y';
}

// The parts of stdin a secret prompt uses; a test passes its own.
interface SecretInput {
  isRaw?: boolean;
  setRawMode?: (mode: boolean) => unknown;
  setEncoding: (encoding: BufferEncoding) => unknown;
  on: (event: 'data', listener: (chunk: string) => void) => unknown;
  removeListener: (event: 'data', listener: (chunk: string) => void) => unknown;
  resume: () => unknown;
  pause: () => unknown;
}

/*
  One line of input. A secret is read in raw mode and echoed only as
  asterisks — never through readline, whose redraws (after a backspace, on
  wrapping) would print the typed value back in clear.
*/
export async function ask(
  question: string,
  {
    secret = false,
    input = process.stdin,
    output = process.stdout,
  }: { secret?: boolean; input?: SecretInput; output?: Pick<NodeJS.WriteStream, 'write'> } = {}
): Promise<string> {
  if (!secret) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise<string>((resolve) => rl.question(question, resolve));
    rl.close();
    return answer;
  }
  if (!input.setRawMode) {
    throw new Error('A secret can only be entered in an interactive terminal');
  }
  const setRawMode = input.setRawMode.bind(input);
  output.write(question);
  return await new Promise<string>((resolve, reject) => {
    let chars: string[] = [];
    const wasRaw = Boolean(input.isRaw);
    const finish = () => {
      input.removeListener('data', onData);
      setRawMode(wasRaw);
      input.pause();
      output.write('\n');
    };
    const onData = (chunk: string) => {
      // Arrow keys and other escape sequences arrive as one chunk; none of them is input.
      if (chunk.startsWith('\u001b')) {
        return;
      }
      for (const char of chunk) {
        if (char === '\r' || char === '\n') {
          finish();
          resolve(chars.join(''));
          return;
        }
        if (char === '\u0003' || char === '\u0004') {
          finish();
          reject(new Error('Cancelled'));
          return;
        }
        if (char === '\u007f' || char === '\b') {
          if (chars.length > 0) {
            chars = chars.slice(0, -1);
            output.write('\b \b');
          }
        } else if (char >= ' ') {
          chars = [...chars, char];
          output.write('*');
        }
      }
    };
    setRawMode(true);
    input.setEncoding('utf8');
    input.resume();
    input.on('data', onData);
  });
}
