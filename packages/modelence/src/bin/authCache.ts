import { promises as fs } from 'fs';
import os from 'os';
import { dirname, join } from 'path';

/*
  Cached deploy authorization, per Studio host, in the user's home directory
  (never in the project). Written only after a browser approval, dropped by
  `modelence logout` or when Studio rejects it. MODELENCE_HOME overrides the
  location (tests, sandboxes).
*/

const AUTH_FILE = 'auth.json';
// A token about to expire is treated as expired so a deploy doesn't fail
// halfway through its polling.
const EXPIRY_MARGIN_MS = 60 * 1000;

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
