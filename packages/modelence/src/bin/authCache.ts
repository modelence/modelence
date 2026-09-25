import { promises as fs } from 'fs';
import os from 'os';
import { dirname, join } from 'path';

/*
  Cached deploy authorization, per Studio host, in the user's home directory
  (never in the project). Written only after a browser approval, dropped by
  `modelence logout` or when Studio rejects it. MODELENCE_HOME changes the
  location (tests, sandboxes).
*/

const AUTH_FILE = 'auth.json';
/*
  A token that could expire during a deploy is treated as expired, so a
  deploy doesn't fail halfway through its polling. That is the longest a
  deploy waits: provisioning plus build polling (PROVISION_TIMEOUT_MS +
  POLL_TIMEOUT_MS in deployStatus.ts). Deploy tokens last one hour, so a
  login is reused for the first 20 minutes.
*/
const EXPIRY_MARGIN_MS = 40 * 60 * 1000;

interface CachedToken {
  token: string;
  expiresAt: string;
}

interface AuthFile {
  hosts?: Record<string, CachedToken>;
}

export function getAuthCachePath(): string {
  const home = process.env.MODELENCE_HOME || join(os.homedir(), '.modelence');
  return join(home, AUTH_FILE);
}

async function readAuthFile(): Promise<AuthFile> {
  try {
    const parsed = JSON.parse(await fs.readFile(getAuthCachePath(), 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

async function writeAuthFile(content: AuthFile): Promise<void> {
  const path = getAuthCachePath();
  await fs.mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await fs.writeFile(path, JSON.stringify(content, null, 2) + '\n', { mode: 0o600 });
}

export async function readCachedToken(host: string): Promise<string | null> {
  const { hosts = {} } = await readAuthFile();
  const cached = hosts[host];
  if (!cached?.token || !cached.expiresAt) {
    return null;
  }
  if (new Date(cached.expiresAt).getTime() - EXPIRY_MARGIN_MS <= Date.now()) {
    return null;
  }
  return cached.token;
}

// Every saved login, expired ones included, so logout can revoke them all
// server-side; one host's entry when a host is given.
export async function listCachedTokens(host?: string): Promise<{ host: string; token: string }[]> {
  const { hosts = {} } = await readAuthFile();
  return Object.entries(hosts)
    .filter(([entryHost, cached]) => (!host || entryHost === host) && Boolean(cached?.token))
    .map(([entryHost, cached]) => ({ host: entryHost, token: cached.token }));
}

export async function writeCachedToken(
  host: string,
  token: string,
  expiresAt: string
): Promise<void> {
  const current = await readAuthFile();
  await writeAuthFile({
    ...current,
    hosts: { ...current.hosts, [host]: { token, expiresAt } },
  });
}

export async function clearCachedToken(host?: string): Promise<void> {
  if (!host) {
    await writeAuthFile({});
    return;
  }
  const current = await readAuthFile();
  const { [host]: _removed, ...rest } = current.hosts ?? {};
  await writeAuthFile({ ...current, hosts: rest });
}
