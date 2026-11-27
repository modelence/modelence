import { promises as fs } from 'fs';
import os from 'os';
import { dirname, join } from 'path';

/*
  Saved CLI logins, in the user's home directory (never in the project).
  MODELENCE_HOME changes the location (tests, sandboxes).

  A login covers one app on one Studio host, and lists what it may do in
  each of that app's environments, as approved in the browser. It lasts up
  to 30 days; it goes on `modelence logout` or when Studio rejects it.

  A pending sign-in is one started where nobody watches the terminal (an
  agent's shell): the CLI printed the link and exited, and the next run
  picks the token up once the person has approved, instead of starting over.
*/

const AUTH_FILE = 'auth.json';
/*
  A token that could expire during a deploy is treated as expired, so a
  deploy doesn't fail halfway through its polling. That is the longest a
  deploy waits: provisioning plus build polling (PROVISION_TIMEOUT_MS +
  POLL_TIMEOUT_MS in deployStatus.ts).
*/
const EXPIRY_MARGIN_MS = 40 * 60 * 1000;

export interface LoginEnvironment {
  alias: string;
  access: 'read' | 'write';
}

export interface CachedLogin {
  token: string;
  expiresAt: string;
  appId: string;
  appAlias: string;
  environments: LoginEnvironment[];
}

export interface PendingSignIn {
  code: string;
  // Absent for a Studio that predates PKCE.
  codeVerifier?: string;
  verificationUrl: string;
  expiresAt: string;
}

// Which app a command works on: its id from .modelence/project.json, or --app.
export interface AppRef {
  appId?: string;
  appAlias?: string;
}

interface LegacyToken {
  token: string;
  expiresAt: string;
}

interface AuthFile {
  // Saved by CLIs before logins were per app: one token per host, an hour at most.
  hosts?: Record<string, LegacyToken>;
  logins?: Record<string, CachedLogin[]>;
  // Per host, then per project directory and app (pendingSignInKey).
  pending?: Record<string, Record<string, PendingSignIn>>;
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

// Through a temporary file, so commands running side by side never read half a file.
async function writeAuthFile(content: AuthFile): Promise<void> {
  const path = getAuthCachePath();
  await fs.mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(content, null, 2) + '\n', { mode: 0o600 });
  await fs.rename(temporary, path);
}

function matchesApp(login: CachedLogin, app: AppRef): boolean {
  return Boolean(
    (app.appId && login.appId === app.appId) || (app.appAlias && login.appAlias === app.appAlias)
  );
}

function isFresh(expiresAt: string, marginMs: number): boolean {
  return new Date(expiresAt).getTime() - marginMs > Date.now();
}

// `expiryMarginMs` is how long the token still has to last.
export async function readLogin(
  host: string,
  app: AppRef,
  expiryMarginMs = EXPIRY_MARGIN_MS
): Promise<CachedLogin | null> {
  const { logins = {} } = await readAuthFile();
  const login = (logins[host] ?? []).find((candidate) => matchesApp(candidate, app));
  if (!login?.token || !login.expiresAt || !isFresh(login.expiresAt, expiryMarginMs)) {
    return null;
  }
  return login;
}

// Replaces the host's login for the same app, and drops expired ones.
export async function writeLogin(host: string, login: CachedLogin): Promise<void> {
  const current = await readAuthFile();
  const others = (current.logins?.[host] ?? []).filter(
    (candidate) => candidate.appId !== login.appId && isFresh(candidate.expiresAt, 0)
  );
  await writeAuthFile({
    ...current,
    logins: { ...current.logins, [host]: [...others, login] },
  });
}

// Every saved token, expired ones included, so logout can revoke them all
// server-side; one host's when a host is given.
export async function listCachedTokens(host?: string): Promise<{ host: string; token: string }[]> {
  const { hosts = {}, logins = {} } = await readAuthFile();
  const legacy = Object.entries(hosts).map(([entryHost, cached]) => ({
    host: entryHost,
    token: cached?.token,
  }));
  const current = Object.entries(logins).flatMap(([entryHost, entries]) =>
    (entries ?? []).map((login) => ({ host: entryHost, token: login.token }))
  );
  return [...legacy, ...current].filter(
    (entry): entry is { host: string; token: string } =>
      (!host || entry.host === host) && Boolean(entry.token)
  );
}

// Everything saved for one host, or for all of them.
export async function clearCachedToken(host?: string): Promise<void> {
  if (!host) {
    await writeAuthFile({});
    return;
  }
  const current = await readAuthFile();
  const { [host]: _legacy, ...hosts } = current.hosts ?? {};
  const { [host]: _logins, ...logins } = current.logins ?? {};
  const { [host]: _pending, ...pending } = current.pending ?? {};
  await writeAuthFile({ hosts, logins, pending });
}

/*
  A pending sign-in belongs to the project it was started in, not only to
  the app it names. Two new projects name no app yet, and one must never
  collect the login approved for the other, then deploy into that app.
*/
export function pendingSignInKey(projectDir: string, app: AppRef): string {
  return JSON.stringify([projectDir, app.appId ?? app.appAlias ?? '']);
}

export async function readPendingSignIn(host: string, key: string): Promise<PendingSignIn | null> {
  const { pending = {} } = await readAuthFile();
  const entry = pending[host]?.[key];
  return entry && isFresh(entry.expiresAt, 0) ? entry : null;
}

export async function writePendingSignIn(
  host: string,
  key: string,
  entry: PendingSignIn
): Promise<void> {
  const current = await readAuthFile();
  await writeAuthFile({
    ...current,
    pending: { ...current.pending, [host]: { ...current.pending?.[host], [key]: entry } },
  });
}

export async function clearPendingSignIn(host: string, key: string): Promise<void> {
  const current = await readAuthFile();
  const { [key]: _removed, ...rest } = current.pending?.[host] ?? {};
  await writeAuthFile({ ...current, pending: { ...current.pending, [host]: rest } });
}
