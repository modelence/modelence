import open from 'open';
import { writeFileSync } from 'fs';
import { join } from 'path';

export async function authenticateCli(host: string) {
  // TODO: check if a token already exists in .modelence/auth.json

  const response = await fetch(`${host}/api/cli/auth`, {
    method: 'POST',
  });

  if (!response.ok) {
    throw new Error('Failed to create CLI authentication code');
  }

  const { code, verificationUrl } = await response.json();

  console.log(`Please visit ${verificationUrl} to authenticate`);
  console.log(`Code: ${code}`);

  await open(verificationUrl);

  const token = await waitForAuth(host, code);

  writeFileSync(join(process.cwd(), '.modelence', 'auth.json'), JSON.stringify({ token }));

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
