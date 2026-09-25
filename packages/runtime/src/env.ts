import { errorMessage, log, sleep } from './log';

export type ProcessEnv = Record<string, string | undefined>;

/*
  How long a container keeps trying to reach Modelence Cloud for its
  variables. Each request gets a timeout so a hung Studio fails fast and the
  next attempt starts; the backoff rides out a short outage or a Studio
  deploy instead of failing the container within seconds.
*/
export interface FetchPolicy {
  requestTimeoutMs: number;
  retryWindowMs: number;
  firstDelayMs: number;
  maxDelayMs: number;
}

export const DEFAULT_FETCH_POLICY: FetchPolicy = {
  requestTimeoutMs: 10_000,
  retryWindowMs: 5 * 60_000,
  firstDelayMs: 1000,
  maxDelayMs: 15_000,
};

// A rejected service token will not become valid by asking again.
const NON_RETRYABLE_STATUSES = [401, 403];

class RejectedError extends Error {}

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

async function fetchOnce(
  endpoint: string,
  token: string,
  timeoutMs: number
): Promise<Record<string, unknown>> {
  let response: Response;
  let body: { env?: unknown };
  try {
    response = await fetch(endpoint + '/api/env', {
      headers: { Authorization: 'Bearer ' + token },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      const message = 'HTTP ' + response.status;
      throw NON_RETRYABLE_STATUSES.includes(response.status)
        ? new RejectedError(message + ': the service token was rejected')
        : new Error(message);
    }
    body = (await response.json()) as { env?: unknown };
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new Error(`no response within ${timeoutMs / 1000}s`);
    }
    throw error;
  }
  return body.env && typeof body.env === 'object' ? (body.env as Record<string, unknown>) : {};
}

export async function fetchRemoteEnv(
  endpoint: string,
  token: string,
  policy: FetchPolicy = DEFAULT_FETCH_POLICY
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + policy.retryWindowMs;
  for (let attempt = 1; ; attempt++) {
    try {
      return await fetchOnce(endpoint, token, policy.requestTimeoutMs);
    } catch (error) {
      if (error instanceof RejectedError) {
        throw new Error('Could not fetch the environment: ' + error.message);
      }
      const delay = Math.min(policy.firstDelayMs * 2 ** (attempt - 1), policy.maxDelayMs);
      if (Date.now() + delay >= deadline) {
        throw new Error(
          `Could not fetch the environment within ${policy.retryWindowMs / 1000}s ` +
            `(${attempt} attempts): ${errorMessage(error)}`
        );
      }
      log(
        `Could not fetch the environment (attempt ${attempt}): ${errorMessage(error)}; ` +
          `retrying in ${delay / 1000}s`
      );
      await sleep(delay);
    }
  }
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
  const retryWindowSeconds = Number(existing.MODELENCE_ENV_FETCH_TIMEOUT);
  const remote = await fetchRemoteEnv(endpoint, token, {
    ...DEFAULT_FETCH_POLICY,
    ...(retryWindowSeconds > 0 ? { retryWindowMs: retryWindowSeconds * 1000 } : {}),
  });
  log(`Loaded ${Object.keys(remote).length} environment variable(s)`);
  return mergeRuntimeEnv(remote, existing);
}
