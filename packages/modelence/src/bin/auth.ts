import { createHash, randomBytes } from 'crypto';
import open from 'open';
import type { EnvDeclaration } from './appSpec';

/*
  Browser device authorization: the CLI mints a code, the user approves it in
  the browser, and the CLI polls until approval binds a token to the code.

  The code is printed, so it ends up in scrollback and agent transcripts; it
  must not be enough to collect the token. Each sign-in keeps a secret in this
  process, sends Studio only its hash, and proves it when collecting. Studio
  hands the token out once. A Studio that doesn't report accepting the hash
  predates all this, and is polled by the code alone.

  Two approval modes, chosen by `pick`:
    'environment' — `modelence setup`: the page also asks which local
                    environment to connect the project to (an existing one,
                    or one created there in an existing or new app). The
                    choice is stamped on the token; /api/setup derives its
                    target from there.
                    `createOnly` (`setup --new`) leaves out existing ones.
    'deploy'      — `modelence deploy`: the page asks where to deploy (an
                    existing or newly created app / cloud environment) and the
                    token route reports the pick back so the CLI deploys
                    there (and records the app in .modelence/project.json).
  Without `pick` the page only authorizes the device.

  `purpose: 'cli'` is a login for `modelence deploy` and the environment
  commands: the page asks which app, and what the terminal may do in each of
  its environments, and the login lasts 30 days. `purpose: 'deploy'` is what
  released CLIs ask for (the same, for an hour).

  `appId` is the hint from .modelence/project.json used to preselect the app.
  `hint` is the target -a/-e name (the app may come from
  .modelence/project.json), which the page preselects, or offers to create
  when the app has no such environment.

  `env` is what modelence.config.json declares. With the deploy picker, the
  page asks for those variables' values as a separate step after the target,
  so a new environment has them before its first build. Studio versions
  without that step ignore the body.
*/

export type CliAuthPick = 'environment' | 'deploy';

export interface CliAuthTarget {
  appId: string;
  appAlias: string;
  environmentId: string;
  envAlias: string;
}

// What a 'cli' login covers, as Studio reports it when the token is collected.
export interface CliAuthLogin {
  appId: string;
  appAlias: string;
  environments: { id: string; alias: string; access: 'read' | 'write' }[];
}

export interface CliAuthResult {
  token: string;
  // Absent on older Studio versions (tokens then last one hour).
  expiresAt?: string;
  target?: CliAuthTarget;
  // Absent for setup tokens and on Studio versions before scoped logins.
  login?: CliAuthLogin;
}

export interface CliAuthOptions {
  pick?: CliAuthPick;
  purpose?: 'deploy' | 'cli';
  pickEnvironment?: boolean;
  createOnly?: boolean;
  appId?: string;
  hint?: Partial<Record<'appId' | 'appAlias' | 'envAlias' | 'environmentId', string>>;
  env?: Record<string, EnvDeclaration>;
  // The services modelence.config.json declares, by name.
  services?: string[];
}

// A sign-in waiting for approval in the browser.
export interface StartedSignIn {
  code: string;
  verificationUrl: string;
  // Absent for a Studio that predates PKCE, which is polled by the code alone.
  codeVerifier?: string;
}

// Opens the browser too, for a person at the terminal; waits for the approval.
export async function authenticateCli(
  host: string,
  options: CliAuthOptions = {}
): Promise<CliAuthResult> {
  const started = await startSignIn(host, options);
  try {
    await open(started.verificationUrl);
  } catch {
    // Headless/SSH/container — no browser to open. The URL and code are
    // already printed, so authentication can proceed manually.
    process.stderr.write(
      'Could not open a browser automatically. Please open the URL above manually.\n'
    );
  }
  return await waitForAuth(host, started.code, started.codeVerifier);
}

/*
  Creates the code and prints the link, before anything else and on stderr:
  stdout may be piped through something that holds it until the command
  exits (`| tail`), and an agent then never sees the link it has to pass on.
*/
export async function startSignIn(
  host: string,
  {
    pick,
    purpose,
    pickEnvironment = false,
    createOnly = false,
    appId,
    hint,
    env,
    services,
  }: CliAuthOptions = {}
): Promise<StartedSignIn> {
  // Only the picker has a variables step; nothing is sent otherwise.
  const declaredEnv = pick === 'deploy' && env && Object.keys(env).length > 0 ? env : undefined;
  // A new environment created on the page is sized for every service, so a
  // free size that can't hold them all isn't offered.
  const sizesEnvironments = pick === 'deploy' || purpose === 'cli';
  const declaredServices =
    sizesEnvironments && services && services.length > 0 ? services : undefined;
  const codeVerifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
  const response = await fetch(`${host}/api/cli/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      codeChallenge,
      ...(declaredEnv ? { env: declaredEnv } : {}),
      ...(declaredServices ? { services: declaredServices } : {}),
    }),
  });

  if (!response.ok) {
    // e.g. a 429, whose message says that waiting helps.
    const reason =
      studioError(await response.text().catch(() => '')) ??
      `${response.status} ${response.statusText}`;
    throw new Error(`Failed to create CLI authentication code: ${reason}`);
  }

  const { code, verificationUrl, codeChallengeAccepted } = await response.json();
  const url = new URL(verificationUrl);
  const resolvedPick = pick ?? (pickEnvironment ? 'environment' : undefined);
  if (resolvedPick) {
    url.searchParams.set('pick', resolvedPick);
  }
  if (resolvedPick === 'environment' && createOnly) {
    url.searchParams.set('new', '1');
  }
  if (purpose) {
    url.searchParams.set('purpose', purpose);
  }
  if (appId) {
    url.searchParams.set('appId', appId);
  }
  for (const [key, value] of Object.entries(hint ?? {})) {
    url.searchParams.set(key, value);
  }

  process.stderr.write(`Sign in to Modelence Cloud: ${url}\nCode: ${code}\n`);

  return {
    code,
    verificationUrl: url.toString(),
    ...(codeChallengeAccepted ? { codeVerifier } : {}),
  };
}

// The code can no longer be approved: it expired, was used, or never existed.
export class DeadCodeError extends Error {}

export async function waitForAuth(
  host: string,
  code: string,
  codeVerifier: string | undefined
): Promise<CliAuthResult> {
  // Short, since the browser moves on to the deployment page right away.
  const pollInterval = 2 * 1000;
  const pollTimeout = 10 * 60 * 1000; // 10 minutes
  const pollExpireTs = Date.now() + pollTimeout;
  let reportedError = false;
  while (Date.now() < pollExpireTs) {
    try {
      const result = await pollForToken(host, code, codeVerifier);
      if (result) {
        return result;
      }
    } catch (error) {
      if (error instanceof DeadCodeError) {
        throw error;
      }
      // Network trouble or a server hiccup: keep polling, and say so once
      // rather than on every poll.
      if (!reportedError) {
        reportedError = true;
        console.error('Error polling for CLI token (retrying):', error);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  throw new Error('Unable to authenticate CLI - timed out. Please try again.');
}

async function requestToken(host: string, code: string, codeVerifier: string | undefined) {
  if (!codeVerifier) {
    return await fetch(`${host}/api/cli/token?code=${code}`, { method: 'GET' });
  }
  // In the body, since URLs end up in proxy logs.
  return await fetch(`${host}/api/cli/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, codeVerifier }),
  });
}

// One poll: the token once approved, null while still pending.
export async function pollForToken(
  host: string,
  code: string,
  codeVerifier: string | undefined
): Promise<CliAuthResult | null> {
  const response = await requestToken(host, code, codeVerifier);

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    // Studio answers a dead code with a 4xx, or — older versions — a 500
    // carrying this message; polling longer cannot revive it.
    // A 404 or 405 here is an older Studio instance, reached mid-rollout, that
    // has no POST route yet; the next poll can reach a newer one.
    const missingRoute = Boolean(codeVerifier) && [404, 405].includes(response.status);
    const clientError =
      response.status >= 400 && response.status < 500 && response.status !== 429 && !missingRoute;
    // Studio's reason, when it gives one, tells e.g. a verifier mismatch (403)
    // apart from an expired code.
    const reason = studioError(body);
    if (clientError || body.includes('Invalid or expired code')) {
      throw new DeadCodeError(
        `${withPeriod(reason ?? 'The sign-in code has expired or is no longer valid')} ` +
          'Please run the command again.'
      );
    }
    throw new Error(
      `CLI token polling failed: ${response.status} ${response.statusText}` +
        (reason ? ` (${reason})` : '')
    );
  }

  const { token, expiresAt, target, login } = await response.json();
  if (!token) {
    return null;
  }
  return { token, expiresAt, target, login: login ?? undefined };
}

// Studio's `{ error }` message from a failed response body. Anything else
// (HTML from a proxy, plain text) is not shown as-is.
function studioError(body: string): string | undefined {
  try {
    const { error } = JSON.parse(body);
    return typeof error === 'string' && error.trim() ? error.trim() : undefined;
  } catch {
    return undefined;
  }
}

function withPeriod(message: string): string {
  return /[.!?]$/.test(message) ? message : `${message}.`;
}
