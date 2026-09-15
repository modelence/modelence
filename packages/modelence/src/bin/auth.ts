import open from 'open';

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

  `appId` is the hint from .modelence/project.json used to preselect the app.
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
    pickEnvironment = false,
    appId,
  }: { pick?: CliAuthPick; pickEnvironment?: boolean; appId?: string } = {}
): Promise<CliAuthResult> {
  const response = await fetch(`${host}/api/cli/auth`, {
    method: 'POST',
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

async function waitForAuth(host: string, code: string): Promise<CliAuthResult> {
  const pollInterval = 5 * 1000; // 5 seconds
  const pollTimeout = 10 * 60 * 1000; // 10 minutes
  const pollExpireTs = Date.now() + pollTimeout;
  while (Date.now() < pollExpireTs) {
    try {
      const result = await pollForToken(host, code);
      if (result) {
        return result;
      }
    } catch (error) {
      console.error('Error polling for CLI token:', error);
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
    throw new Error(`CLI token polling failed: ${response.statusText}`);
  }

  const { token, expiresAt, target } = await response.json();
  if (!token) {
    return null;
  }
  return { token, expiresAt, target };
}
