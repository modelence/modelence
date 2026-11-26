/*
  Thin JSON client for Studio's CLI routes. Errors carry the HTTP status so
  callers can tell an expired token (401) from everything else.
*/

export class StudioApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    // Whether the body was a JSON error, which only Studio's routes answer with.
    public readonly isJson = false
  ) {
    super(message);
    this.name = 'StudioApiError';
  }
}

// Worth trying again: no network, or a Studio that is busy or restarting.
export function isTransientError(error: unknown): boolean {
  if (error instanceof StudioApiError) {
    return error.status === 429 || error.status >= 500;
  }
  // What fetch throws when there is no network.
  return error instanceof TypeError;
}

export async function studioRequest<T>(
  host: string,
  path: string,
  {
    method = 'GET',
    token,
    body,
    query,
  }: {
    method?: 'GET' | 'POST';
    token?: string;
    body?: unknown;
    query?: Record<string, string | number>;
  } = {}
): Promise<T> {
  // Appended rather than resolved: new URL('/api/…', host) would drop the path
  // of a Studio served under a prefix (see normalizeHost).
  const url = new URL(`${host}${path}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    url.searchParams.set(key, String(value));
  }

  const headers: Record<string, string> = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    let message = text || response.statusText;
    let isJson = false;
    try {
      const parsed = JSON.parse(text);
      const reason = parsed.error || parsed.message;
      isJson = Boolean(reason);
      message = reason || message;
    } catch {
      // Plain-text error body.
    }
    throw new StudioApiError(message, response.status, isJson);
  }

  return (await response.json()) as T;
}
