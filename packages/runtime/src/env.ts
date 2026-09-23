import { errorMessage, log, sleep } from './log';

export type ProcessEnv = Record<string, string | undefined>;

const FETCH_ATTEMPTS = 5;
const RETRY_BASE_DELAY_MS = 2000;

/*
  Names the platform owns. The task definition sets PORT and the MODELENCE_*
  variables; a remote value for them is ignored. Everything else the
  environment defines wins over the image — including NODE_OPTIONS, the
  knob people most often bring along.
*/
function isPlatformEnvName(name: string): boolean {
  return name === 'PORT' || name.startsWith('MODELENCE_');
}

export function mergeRuntimeEnv(remote: Record<string, unknown>, existing: ProcessEnv): ProcessEnv {
  const result: ProcessEnv = { ...existing };
  for (const [name, value] of Object.entries(remote)) {
    if (isPlatformEnvName(name) || value === null || value === undefined) {
      continue;
    }
    result[name] = String(value);
  }
  return result;
}

async function fetchRemoteEnv(endpoint: string, token: string): Promise<Record<string, unknown>> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(endpoint + '/api/env', {
        headers: { Authorization: 'Bearer ' + token },
      });
      if (!response.ok) {
        throw new Error('HTTP ' + response.status);
      }
      const { env } = (await response.json()) as { env?: unknown };
      return env && typeof env === 'object' ? (env as Record<string, unknown>) : {};
    } catch (error) {
      lastError = error;
      log(
        `Could not fetch the environment (attempt ${attempt}/${FETCH_ATTEMPTS}): ${errorMessage(error)}`
      );
      if (attempt < FETCH_ATTEMPTS) {
        await sleep(RETRY_BASE_DELAY_MS * attempt);
      }
    }
  }
  throw lastError;
}

/*
  The environment the app starts with: the image's, with the variables set in
  the Modelence dashboard on top. Refusing to boot without them is
  deliberate: ECS restarts the task, and a loud crash beats an app silently
  running with no database.
*/
export async function loadRuntimeEnv(existing: ProcessEnv): Promise<ProcessEnv> {
  const endpoint = existing.MODELENCE_SERVICE_ENDPOINT;
  const token = existing.MODELENCE_SERVICE_TOKEN;
  if (!endpoint || !token) {
    log('No Modelence service endpoint configured; starting with the image environment only');
    return { ...existing };
  }
  const remote = await fetchRemoteEnv(endpoint, token);
  log(`Loaded ${Object.keys(remote).length} environment variable(s)`);
  return mergeRuntimeEnv(remote, existing);
}
