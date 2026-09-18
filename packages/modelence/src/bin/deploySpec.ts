import {
  APP_SPEC_FILE_NAME,
  definedOnly,
  formatAppSpec,
  mergeAppSpecs,
  readAppSpecFile,
  type AppSpec,
  type StaticMount,
} from './appSpec';
import { detectAppSpec } from './detect';
import { resolveAppRoot } from './detect/root';
import type { DeployOptions } from './deploy';

export interface SpecLayers {
  file: AppSpec | null;
  overrides: AppSpec;
  detected: AppSpec;
}

// Reads modelence.json, runs detection and prints the plan this run will
// deploy with (before the environment's own settings, which only the server
// knows).
export async function prepareSpecLayers(cwd: string, options: DeployOptions): Promise<SpecLayers> {
  const file = await readAppSpecFile(cwd);
  const overrides = specFromFlags(options);
  const appRoot = await resolveAppRoot(cwd, overrides.build?.root ?? file?.build?.root);
  const detected = await detectAppSpec(appRoot);
  const preview = mergeAppSpecs(detected.spec, file, overrides);
  const fieldSources = { ...detected.sources };
  for (const [name, layer] of [
    [APP_SPEC_FILE_NAME, file],
    ['flags', overrides],
  ] as const) {
    if (layer?.runtime) fieldSources.runtime = name;
    for (const section of ['build', 'web'] as const) {
      for (const key of Object.keys(layer?.[section] ?? {})) {
        fieldSources[`${section}.${key}`] = name;
      }
    }
  }

  const sources = [
    detected.profile ? `${detected.profile} project` : null,
    file ? APP_SPEC_FILE_NAME : null,
    Object.keys(overrides).length > 0 ? 'flags' : null,
  ].filter(Boolean);
  console.log(`Build plan${sources.length > 0 ? ` (${sources.join(', ')})` : ''}:`);
  for (const line of formatAppSpec(preview, fieldSources)) {
    console.log(line);
  }
  for (const note of detected.notes) {
    console.log(`  note: ${note}`);
  }
  if (!file) {
    console.log(`  tip: run \`modelence init\` to write this plan to ${APP_SPEC_FILE_NAME}.`);
  }

  return { file, overrides, detected: detected.spec };
}

// Flags → one spec layer, only the keys that were passed.
export function specFromFlags(options: DeployOptions): AppSpec {
  const build = definedOnly({
    node: options.nodeVersion,
    root: options.rootDir,
    install: options.installCommand,
    command: options.buildCommand,
  });
  const web = definedOnly({
    start: options.startCommand,
    static: options.static === undefined ? undefined : options.static.map(parseStaticFlag),
  });
  return {
    ...(options.runtime ? { runtime: options.runtime as AppSpec['runtime'] } : {}),
    ...(Object.keys(build).length > 0 ? { build } : {}),
    ...(Object.keys(web).length > 0 ? { web } : {}),
  };
}

// --static "/=client/dist" or "/docs=docs/build"; a bare directory mounts at /.
export function parseStaticFlag(value: string): StaticMount {
  const separator = value.indexOf('=');
  if (separator === -1) {
    return { path: '/', dir: value };
  }
  return { path: value.slice(0, separator) || '/', dir: value.slice(separator + 1) };
}

// A resolved spec as the server reports it: every key present.
export interface ResolvedSpec {
  runtime: string;
  build: { node: string; root: string; install: string; command: string };
  web: { start?: string | null; static: StaticMount[] };
}

// The environment's Build & Deploy settings sit between the flags and the
// file; when they changed the outcome, say so, since that is otherwise only
// visible in the dashboard.
export function reportEnvironmentSettings(used: ResolvedSpec, local: AppSpec) {
  const differences: string[] = [];
  const compare = (
    label: string,
    usedValue: string | null | undefined,
    localValue: string | undefined
  ) => {
    if (localValue !== undefined && (usedValue ?? '') !== localValue) {
      differences.push(`${label} "${usedValue ?? ''}" (here "${localValue}")`);
    }
  };
  compare('install', used.build.install, local.build?.install);
  compare('build', used.build.command, local.build?.command);
  compare('start', used.web.start, local.web?.start);
  if (local.runtime && used.runtime !== local.runtime) {
    differences.push(`runtime ${used.runtime} (here ${local.runtime})`);
  }
  const usedMounts = JSON.stringify(used.web.static);
  if (local.web?.static && usedMounts !== JSON.stringify(local.web.static)) {
    differences.push('static directories');
  }
  if (differences.length > 0) {
    console.log("Using the environment's Build & Deploy settings: " + differences.join(', '));
    console.log('Edit them in the dashboard to change this.');
  }
}
