import {
  AGENT_SETUP_PROMPT,
  APP_SPEC_FILE_NAME,
  SETUP_DOCS_URL,
  addFrameworkResources,
  formatAppSpec,
  isProvidedResource,
  readAppSpecFile,
  type AppSpec,
  type StaticMount,
} from './appSpec';
import { resolveAppRoot } from './appRoot';
import { dependsOnModelence } from './deployKind';

/*
  modelence.config.json is the whole contract between a project and Modelence
  Cloud: the CLI reads it, checks what only the local file system can tell
  (the file exists, root is a real directory in the upload) and sends
  it on. Studio validates it against the schema and fills in the runtime's
  defaults; nothing is inferred here.
*/

const KNOWN_TOP_LEVEL_KEYS = ['$schema', 'resources', 'env'];

/*
  Reads and checks modelence.config.json, prints the plan and returns the
  spec for the deploy request: the file's content, plus the MongoDB and
  Elastic a Modelence framework app needs when the file leaves them out
  (addFrameworkResources). Throws when there is no file.
*/
export async function prepareSpec(cwd: string): Promise<AppSpec> {
  const file = await readAppSpecFile(cwd);
  if (!file) {
    throw new Error(missingSpecMessage(cwd));
  }
  assertKnownKeys(file);
  const { spec, added } = (await dependsOnModelence(cwd))
    ? addFrameworkResources(file)
    : { spec: file, added: [] };
  for (const resource of Object.values(spec.resources ?? {})) {
    if (resource && !isProvidedResource(resource) && resource.root !== undefined) {
      await resolveAppRoot(cwd, resource.root);
    }
  }

  console.log(`Build plan (${APP_SPEC_FILE_NAME}):`);
  for (const line of formatAppSpec(spec)) {
    console.log(line);
  }
  if (added.length > 0) {
    console.log(`  (${added.join(' and ')} added: a Modelence app always needs them)`);
  }
  return spec;
}

export function missingSpecMessage(cwd: string): string {
  return [
    `${APP_SPEC_FILE_NAME} not found in ${cwd}.`,
    'Modelence Cloud builds and runs your app exactly as this file describes (install, build and start commands, Node.js version, static directories).',
    'Ask your coding agent to create it with this prompt:',
    '',
    `  ${AGENT_SETUP_PROMPT}`,
    '',
    `Reference: ${SETUP_DOCS_URL}`,
  ].join('\n');
}

// A typo at the top level (say "builds") would otherwise be dropped by the
// server's schema check with a less specific message, or worse, ignored.
function assertKnownKeys(spec: AppSpec): void {
  const unknown = Object.keys(spec).filter((key) => !KNOWN_TOP_LEVEL_KEYS.includes(key));
  if (unknown.length > 0) {
    throw new Error(
      `${APP_SPEC_FILE_NAME} has unknown key "${unknown[0]}" (allowed: ${KNOWN_TOP_LEVEL_KEYS.join(', ')}).`
    );
  }
  for (const section of ['resources', 'env'] as const) {
    const value = spec[section];
    if (value !== undefined && (!value || typeof value !== 'object' || Array.isArray(value))) {
      throw new Error(`${APP_SPEC_FILE_NAME}: "${section}" must be an object.`);
    }
  }
  // Studio rejects these too, but only after the archive is packed and
  // uploaded, and the plan printed before that reads these shapes as typed.
  // An empty build list is "no build step"; an empty command never is.
  for (const [name, resource] of Object.entries(spec.resources ?? {})) {
    if (!isPlainObject(resource)) {
      throw new Error(`${APP_SPEC_FILE_NAME}: "resources.${name}" must be an object.`);
    }
    for (const section of ['build', 'start', 'dev'] as const) {
      assertCommandList(resource[section], `resources.${name}.${section}`);
    }
    assertPathList(resource.watchPaths, `resources.${name}.watchPaths`);
    assertPortList(resource.ports, `resources.${name}.ports`);
  }
}

export function assertCommandList(list: unknown, path: string): void {
  if (list === undefined) {
    return;
  }
  if (!isPlainObject(list) || !Array.isArray(list.commands)) {
    throw new Error(
      `${APP_SPEC_FILE_NAME}: "${path}" must be an object with a "commands" array, e.g. { "commands": ["npm ci"] }.`
    );
  }
  list.commands.forEach((command: unknown, index: number) => {
    if (typeof command !== 'string') {
      throw new Error(`${APP_SPEC_FILE_NAME}: "${path}.commands.${index}" must be a string.`);
    }
    if (command.trim() === '') {
      throw new Error(`${APP_SPEC_FILE_NAME}: "${path}.commands.${index}" must not be empty.`);
    }
  });
}

/*
  Only the shape: Studio checks each path against the uploaded archive. An
  empty list would mean no change ever rebuilds the service, which is never
  what was meant, so it is refused rather than read as "rebuild on nothing".
*/
function assertPathList(list: unknown, path: string): void {
  if (list === undefined) {
    return;
  }
  const isPathList =
    Array.isArray(list) &&
    list.length > 0 &&
    list.every((entry: unknown) => typeof entry === 'string' && entry.trim() !== '');
  if (!isPathList) {
    throw new Error(
      `${APP_SPEC_FILE_NAME}: "${path}" must be a non-empty list of paths, e.g. ["api", "shared"].`
    );
  }
}

const MAX_PORT = 65535;

/*
  Only the shape, like the watch paths: Studio enforces the count and the
  main-port rules. A single number, as `port` used to be, is the likely
  mistake, and the plan would otherwise crash on it.
*/
function assertPortList(list: unknown, path: string): void {
  if (list === undefined) {
    return;
  }
  const isPortList =
    Array.isArray(list) &&
    list.length > 0 &&
    list.every(
      (entry: unknown) => Number.isInteger(entry) && Number(entry) >= 1 && Number(entry) <= MAX_PORT
    );
  if (!isPortList) {
    throw new Error(
      `${APP_SPEC_FILE_NAME}: "${path}" must be a non-empty list of port numbers, e.g. [8000].`
    );
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

// A resolved spec as the server reports it: every key present, with [] for
// no build step and null for no web process, by resource name.
export interface ResolvedSpec {
  runtime: string;
  resources: Record<
    string,
    {
      type: string;
      build: { image: string; root: string; commands: string[] };
      web: { start: string | null; static: StaticMount[] };
    }
  >;
}
