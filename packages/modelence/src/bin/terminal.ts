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
