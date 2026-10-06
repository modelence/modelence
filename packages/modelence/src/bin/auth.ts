import open from 'open';
import type { EnvDeclaration } from './appSpec';

/*
  Browser device authorization: the CLI mints a code, the user approves it in
  the browser, and the CLI polls until approval binds a token to the code.

  Two approval modes, chosen by `pick`:
    'environment' — `modelence setup`: the page also asks which environment to
                    connect the local project to. The choice is stamped on the
                    token; /api/setup derives its target from there.
    'deploy'      — `modelence deploy`: the page asks where to deploy (an
                    existing or newly created app / cloud environment) and the
                    token route reports the pick back so the CLI can record it
                    in .modelence/project.json.
  Without `pick` the page only authorizes the device.

  `purpose: 'deploy'` asks for a deploy-lifetime token (one hour) without a
  picker — for a deploy whose target is already known from flags or
  .modelence/project.json. `pick: 'deploy'` implies it.

  `appId` is the hint from .modelence/project.json used to preselect the app.

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

export interface CliAuthResult {
  token: string;
  // Absent on older Studio versions (tokens then last one hour).
  expiresAt?: string;
  target?: CliAuthTarget;
}

export async function authenticateCli(
  host: string,
  {
    pick,
    purpose,
    pickEnvironment = false,
    appId,
    env,
  }: {
    pick?: CliAuthPick;
    purpose?: 'deploy';
    pickEnvironment?: boolean;
    appId?: string;
    env?: Record<string, EnvDeclaration>;
  } = {}
): Promise<CliAuthResult> {
  // Only the picker has a variables step; nothing is sent otherwise.
  const declaredEnv = pick === 'deploy' && env && Object.keys(env).length > 0 ? env : undefined;
  const response = await fetch(`${host}/api/cli/auth`, {
    method: 'POST',
    ...(declaredEnv
      ? {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ env: declaredEnv }),
        }
      : {}),
  });

  if (!response.ok) {
    throw new Error('Failed to create CLI authentication code');
  }

  const { code, verificationUrl } = await response.json();
  const url = new URL(verificationUrl);
  const resolvedPick = pick ?? (pickEnvironment ? 'environment' : undefined);
  if (resolvedPick) {
    url.searchParams.set('pick', resolvedPick);
  }
  if (purpose) {
    url.searchParams.set('purpose', purpose);
  }
  if (appId) {
    url.searchParams.set('appId', appId);
  }

  console.log(`Please visit ${url} to authenticate`);
  console.log(`Code: ${code}`);

  try {
    await open(url.toString());
  } catch {
    // Headless/SSH/container — no browser to open. The URL and code above
    // are already printed, so authentication can proceed manually.
    console.log('Could not open a browser automatically. Please open the URL above manually.');
  }

  return await waitForAuth(host, code);
}

// The code can no longer be approved: it expired, was used, or never existed.
class DeadCodeError extends Error {}

async function waitForAuth(host: string, code: string): Promise<CliAuthResult> {
  // Short, since the browser moves on to the deployment page right away.
  const pollInterval = 2 * 1000;
  const pollTimeout = 10 * 60 * 1000; // 10 minutes
  const pollExpireTs = Date.now() + pollTimeout;
  let reportedError = false;
  while (Date.now() < pollExpireTs) {
    try {
      const result = await pollForToken(host, code);
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

async function pollForToken(host: string, code: string): Promise<CliAuthResult | null> {
  const response = await fetch(`${host}/api/cli/token?code=${code}`, {
    method: 'GET',
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    // Studio answers a dead code with a 4xx, or — older versions — a 500
    // carrying this message; polling longer cannot revive it.
    const clientError = response.status >= 400 && response.status < 500 && response.status !== 429;
    if (clientError || body.includes('Invalid or expired code')) {
      throw new DeadCodeError(
        'The sign-in code has expired or is no longer valid. Please run the command again.'
      );
    }
    throw new Error(`CLI token polling failed: ${response.status} ${response.statusText}`);
  }

  const { token, expiresAt, target } = await response.json();
  if (!token) {
    return null;
  }
  return { token, expiresAt, target };
}
