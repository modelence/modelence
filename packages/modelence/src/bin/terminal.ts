/*
  Whether this is a CI run: the browser is never opened, since waiting on an
  approval nobody will give would only hang until a timeout.
*/
export function isCI(): boolean {
  return Boolean(process.env.CI);
}

/*
  Set in the shells AI agents run commands in. Those run a command to the
  end and read its output only then, often through `| tail`, so a sign-in
  link the command waits on is never seen.
*/
const AGENT_ENV_VARS = ['CLAUDECODE', 'CURSOR_AGENT', 'CODEX_SANDBOX', 'GEMINI_CLI'];

export function isAgentShell(): boolean {
  return AGENT_ENV_VARS.some((name) => Boolean(process.env[name]));
}

/*
  Whether a person can see the sign-in link while the command waits for it.
  The link goes to stderr, so that is the stream that has to be a terminal;
  stdout piped into a file or `tee` is still watched.
*/
export function canWaitForSignIn(): boolean {
  return !isCI() && !isAgentShell() && Boolean(process.stderr.isTTY);
}
