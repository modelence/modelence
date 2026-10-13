import fs from 'fs/promises';
import { join } from 'path';
import { parse as parseDotenv } from 'dotenv';

export type ProcessEnv = Record<string, string | undefined>;

const MODELENCE_ENV_FILE = '.modelence.env';
const FETCH_TIMEOUT_MS = 10_000;

/*
  The files dev servers (Next.js, Vite, dotenv) read on their own. A name
  defined there is the developer's local override, and those tools never
  replace a variable already in process.env, so exporting the environment's
  value would silently shadow it.
*/
const PROJECT_ENV_FILES = ['.env', '.env.local', '.env.development', '.env.development.local'];

/*
  Names a local process must not take from the environment: PORT and the
  MODELENCE_* variables belong to the local setup, and the site URL /api/env
  returns is the environment's cloud address, not where this process serves.
*/
function isSkippedName(name: string): boolean {
  return (
    name === 'PORT' || name === 'SITE_URL' || name === 'ROOT_URL' || name.startsWith('MODELENCE_')
  );
}

export function mergeLocalEnv(
  remote: Record<string, unknown>,
  existing: ProcessEnv,
  projectNames: ReadonlySet<string>
): ProcessEnv {
  const added = Object.entries(remote).filter(
    ([name, value]) =>
      value !== null &&
      value !== undefined &&
      !isSkippedName(name) &&
      existing[name] === undefined &&
      !projectNames.has(name)
  );
  return {
    ...existing,
    ...Object.fromEntries(added.map(([name, value]) => [name, String(value)])),
  };
}

async function readEnvFile(path: string): Promise<Record<string, string> | null> {
  try {
    return parseDotenv(await fs.readFile(path, 'utf-8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function readProjectEnvNames(cwd: string): Promise<Set<string>> {
  const files = await Promise.all(PROJECT_ENV_FILES.map((file) => readEnvFile(join(cwd, file))));
  return new Set(files.flatMap((file) => Object.keys(file ?? {})));
}

async function fetchRemoteEnv(endpoint: string, token: string): Promise<Record<string, unknown>> {
  const response = await fetch(`${endpoint.replace(/\/+$/, '')}/api/env`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const body = (await response.json()) as { env?: unknown };
  return body.env && typeof body.env === 'object' ? (body.env as Record<string, unknown>) : {};
}

function describeFetchError(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }
  if (error.name === 'TimeoutError') {
    return `no response within ${FETCH_TIMEOUT_MS / 1000}s`;
  }
  return error.message;
}

/*
  The environment a local process starts with: its own, plus the variables
  of the Modelence environment this project is connected to (managed
  resources such as DATABASE_URL / REDIS_URL, and the environment's own
  variables). Unlike the cloud entrypoint, a failure only warns: a dev server
  that won't start helps nobody, and the app may not need those values yet.
*/
export async function loadLocalEnv(
  cwd: string = process.cwd(),
  existing: ProcessEnv = process.env
): Promise<ProcessEnv> {
  const connection = await readEnvFile(join(cwd, MODELENCE_ENV_FILE));
  const endpoint = connection?.MODELENCE_SERVICE_ENDPOINT;
  const token = connection?.MODELENCE_SERVICE_TOKEN;
  if (!endpoint || !token) {
    console.log(
      'Not connected to a Modelence environment (run `modelence setup`); ' +
        'starting without its variables.'
    );
    return { ...existing };
  }

  let remote: Record<string, unknown>;
  try {
    remote = await fetchRemoteEnv(endpoint, token);
  } catch (error) {
    console.warn(
      `Could not load environment variables from ${endpoint} (${describeFetchError(error)}); ` +
        'starting without them.'
    );
    return { ...existing };
  }

  const merged = mergeLocalEnv(remote, existing, await readProjectEnvNames(cwd));
  const loaded = Object.keys(merged).filter((name) => existing[name] === undefined);
  if (loaded.length > 0) {
    console.log(`Loaded ${loaded.length} environment variable(s): ${loaded.join(', ')}`);
  }
  return merged;
}
