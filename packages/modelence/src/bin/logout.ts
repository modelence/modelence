import { clearCachedToken, getAuthCachePath, listCachedTokens } from './authCache';
import { studioRequest } from './studioApi';

// Forgets the saved deploy login (all hosts, or one with --host). The token
// is revoked on the server first so a copy of the cache file stops working
// too; that part is best effort — offline or already-revoked, the local
// entry still goes.
export async function logout(options: { host?: string }) {
  const cached = await listCachedTokens(options.host);
  await Promise.all(cached.map(({ host, token }) => revokeToken(host, token)));
  await clearCachedToken(options.host);
  console.log(
    options.host
      ? `Removed the saved login for ${options.host}.`
      : `Removed saved logins (${getAuthCachePath()}).`
  );
}

async function revokeToken(host: string, token: string): Promise<void> {
  try {
    await studioRequest(host, '/api/cli/logout', { method: 'POST', token });
  } catch {
    // Unknown token (401) or no network: nothing left to revoke remotely.
  }
}
