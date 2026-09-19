/*
  Thin JSON client for Studio's CLI routes. Errors carry the HTTP status so
  callers can tell an expired token (401) from everything else.
*/

export class StudioApiError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = 'StudioApiError';
  }
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
  const url = new URL(path, host);
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
    try {
      const parsed = JSON.parse(text);
      message = parsed.error || parsed.message || message;
    } catch {
      // Plain-text error body.
    }
    throw new StudioApiError(message, response.status);
  }

  return (await response.json()) as T;
}
