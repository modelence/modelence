import { promises as fs } from 'fs';
import { join } from 'path';

/*
  modelence.json — how the project is built and run on Modelence Cloud. The
  CLI reads it as-is and sends it to Studio, which validates it against the
  schema published at /schema/modelence.json and merges it with the
  environment's settings and the CLI's detection. The types here mirror that
  schema; the server is the authority.
*/

export const APP_SPEC_FILE_NAME = 'modelence.json';

export type AppRuntime = 'node' | 'modelence';

export interface StaticMount {
  path: string;
  dir: string;
}

export interface AppSpec {
  $schema?: string;
  runtime?: AppRuntime;
  build?: {
    node?: string;
    root?: string;
    install?: string;
    command?: string;
    env?: Record<string, string>;
  };
  web?: {
    start?: string;
    static?: StaticMount[];
  };
}

export function getAppSpecFilePath(cwd = process.cwd()): string {
  return join(cwd, APP_SPEC_FILE_NAME);
}

// The file's content, or null when there is none. A file that is not valid
// JSON is an error: silently ignoring it would deploy something else.
export async function readAppSpecFile(cwd = process.cwd()): Promise<AppSpec | null> {
  let content: string;
  try {
    content = await fs.readFile(getAppSpecFilePath(cwd), 'utf8');
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new Error(
      `${APP_SPEC_FILE_NAME} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${APP_SPEC_FILE_NAME} must contain a JSON object`);
  }
  return parsed as AppSpec;
}

export async function writeAppSpecFile(spec: AppSpec, cwd = process.cwd()): Promise<void> {
  await fs.writeFile(getAppSpecFilePath(cwd), JSON.stringify(spec, null, 2) + '\n');
}

// Layers merged the way the server does, for the plan shown before the
// upload: later arguments win; build.env merges by key, mount lists replace.
export function mergeAppSpecs(...layers: (AppSpec | null | undefined)[]): AppSpec {
  return layers.reduce<AppSpec>((merged, layer) => {
    if (!layer) {
      return merged;
    }
    const build = { ...merged.build, ...layer.build };
    if (merged.build?.env || layer.build?.env) {
      build.env = { ...merged.build?.env, ...layer.build?.env };
    }
    const web = { ...merged.web, ...layer.web };
    return dropEmpty({
      ...merged,
      ...(layer.runtime ? { runtime: layer.runtime } : {}),
      build,
      web,
    });
  }, {});
}

function dropEmpty(spec: AppSpec): AppSpec {
  const result: AppSpec = { ...spec };
  if (result.build && Object.keys(result.build).length === 0) {
    delete result.build;
  }
  if (result.web && Object.keys(result.web).length === 0) {
    delete result.web;
  }
  return result;
}

// Only the keys a user actually set, so "unset" stays distinguishable from
// "empty" on the server.
export function definedOnly<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined)
  ) as Partial<T>;
}

export function formatAppSpec(spec: AppSpec): string[] {
  const lines: string[] = [];
  lines.push(`  runtime: ${spec.runtime ?? 'node'}`);
  lines.push(`  node:    ${spec.build?.node ?? 'default (22)'}`);
  if (spec.build?.root && spec.build.root !== '.') {
    lines.push(`  root:    ${spec.build.root}`);
  }
  lines.push(`  install: ${spec.build?.install ?? 'default'}`);
  lines.push(`  build:   ${spec.build?.command || '(none)'}`);
  for (const [key, value] of Object.entries(spec.build?.env ?? {})) {
    lines.push(`  env:     ${key}=${value}`);
  }
  if (spec.web?.start) {
    lines.push(`  start:   ${spec.web.start}`);
  } else if (!spec.web?.static?.length) {
    lines.push('  start:   (none)');
  }
  for (const mount of spec.web?.static ?? []) {
    lines.push(`  static:  ${mount.path} -> ${mount.dir}/`);
  }
  return lines;
}
