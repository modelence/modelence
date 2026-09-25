// JSON of the resolved spec's `web` section, set by Studio's generated
// Dockerfile.
export const WEB_SPEC_ENV_NAME = 'MODELENCE_WEB';

export interface StaticMount {
  // URL prefix the directory is served at: '/' or '/docs'.
  path: string;
  // Directory with the built files, relative to the working directory.
  dir: string;
}

export interface WebSpec {
  start: string | null;
  static: StaticMount[];
}

export function readWebSpec(env: Record<string, string | undefined>): WebSpec | null {
  const raw = env[WEB_SPEC_ENV_NAME];
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    return {
      start: typeof parsed.start === 'string' && parsed.start !== '' ? parsed.start : null,
      static: Array.isArray(parsed.static) ? parsed.static : [],
    };
  } catch {
    return null;
  }
}
