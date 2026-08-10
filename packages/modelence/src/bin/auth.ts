import open from 'open';

/*
  Browser device authorization. The returned token is short-lived and
  user-scoped; commands re-authorize on every run, so no credential is ever
  stored on disk.

  With `pickEnvironment`, the approval page also asks the user to choose an
  environment. The choice never travels back through the CLI — the server
  stamps it on the token itself, and /api/setup derives the target from
  there, so the authorization is only good for the environment the user
  approved.

  `appId` is the hint from .modelence/project.json: the approval page uses it
  to preselect the app this project was last connected to. Purely a
  convenience for the picker — the user can still choose any app, and an
  unresolvable ID is simply ignored.
*/
export async function authenticateCli(
  host: string,
  { pickEnvironment = false, appId }: { pickEnvironment?: boolean; appId?: string } = {}
): Promise<{ token: string }> {
  const response = await fetch(`${host}/api/cli/auth`, {
    method: 'POST',
  });

  if (!response.ok) {
    throw new Error('Failed to create CLI authentication code');
  }

  const { code, verificationUrl } = await response.json();
  const hintParams = new URLSearchParams({
    ...(pickEnvironment ? { pick: 'environment' } : {}),
    ...(appId ? { appId } : {}),
  });
  const url = hintParams.size > 0 ? `${verificationUrl}&${hintParams}` : verificationUrl;

  console.log(`Please visit ${url} to authenticate`);
  console.log(`Code: ${code}`);

  await open(url);

  const token = await waitForAuth(host, code);

  return { token };
}

async function waitForAuth(host: string, code: string): Promise<string> {
  const pollInterval = 5 * 1000; // 5 seconds
  const pollTimeout = 10 * 60 * 1000; // 10 minutes
  const pollExpireTs = Date.now() + pollTimeout;
  while (Date.now() < pollExpireTs) {
    try {
      const token = await pollForToken(host, code);
      if (token) {
        return token;
      }
    } catch (error) {
      console.error('Error polling for CLI token:', error);
    }
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  throw new Error('Unable to authenticate CLI - timed out. Please try again.');
}

async function pollForToken(host: string, code: string) {
  const response = await fetch(`${host}/api/cli/token?code=${code}`, {
    method: 'GET',
  });

  if (!response.ok) {
    throw new Error(`CLI token polling failed: ${response.statusText}`);
  }

  const { token } = await response.json();
  return token;
}
