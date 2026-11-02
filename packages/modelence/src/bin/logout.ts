import { clearCachedToken, getAuthCachePath, listCachedTokens } from './authCache';
import { normalizeHost } from './deploySession';
import { studioRequest } from './studioApi';

// Forgets the saved deploy login (all hosts, or one with --host). The token
// is revoked on the server first so a copy of the cache file stops working
// too; that part is best effort — offline or already-revoked, the local
// entry still goes.
export async function logout(options: { host?: string }) {
  // Normalized like deploy's resolveHost, so the cache key matches.
  const host = options.host ? normalizeHost(options.host) : undefined;
  const cached = await listCachedTokens(host);
  await Promise.all(cached.map((entry) => revokeToken(entry.host, entry.token)));
  await clearCachedToken(host);
  console.log(
    host ? `Removed the saved login for ${host}.` : `Removed saved logins (${getAuthCachePath()}).`
  );
}

async function revokeToken(host: string, token: string): Promise<void> {
  try {
    await studioRequest(host, '/api/cli/logout', { method: 'POST', token });
  } catch {
    // Unknown token (401) or no network: nothing left to revoke remotely.
  }
}
