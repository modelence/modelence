import { clearCachedToken, getAuthCachePath } from './authCache';

// Forgets the saved deploy login (all hosts, or one with --host).
export async function logout(options: { host?: string }) {
  await clearCachedToken(options.host);
  console.log(
    options.host
      ? `Removed the saved login for ${options.host}.`
      : `Removed saved logins (${getAuthCachePath()}).`
  );
}
