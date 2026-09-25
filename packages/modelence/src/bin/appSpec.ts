import { promises as fs } from 'fs';
import { join } from 'path';
import { parse as parseJsonc, printParseErrorCode, type ParseError } from 'jsonc-parser';

/*
  modelence.config.json — how the project is built and run on Modelence Cloud. The
  CLI reads it as-is and sends it to Studio, which validates it against the
  schema published at /schema/modelence.config.json and fills in the defaults.
  The types here mirror that schema; the server is the authority.

  A missing `build` inherits the runtime default (npm install), and
  `"commands": []` means no build step. A missing `start` means no process.
  An empty command string is invalid.
*/

export const APP_SPEC_FILE_NAME = 'modelence.config.json';
// The format version the CLI writes into $schema; Studio publishes the schema.
export const APP_SPEC_VERSION = 1;

// The file is written by the user's coding agent from the hosted setup
// guide; Mintlify serves the same page raw at the .md URL for agents.
export const SETUP_DOCS_URL = 'https://docs.modelence.com/deploy/setup';
export const AGENT_SETUP_PROMPT = `Use ${SETUP_DOCS_URL}.md to set up Modelence deployment for this project`;

export type EnvDeclarationType = 'text' | 'secret';
export type EnvDeclarationScope = 'build' | 'runtime';
export type ResourceType = 'service';

export interface StaticMount {
  path: string;
  dir: string;
}

// Commands run one after another; one failing stops the rest.
export interface CommandList {
  commands: string[];
}

// A client-only site is a service without `start`, serving its `static` mounts.
export interface AppResource {
  type: ResourceType;
  // node-<version>-<variant>, e.g. "node-22-slim" or "node-22.23.1-alpine".
  image?: string;
  root?: string;
  build?: CommandList;
  start?: CommandList;
  static?: StaticMount[];
}

export interface EnvDeclaration {
  type?: EnvDeclarationType;
  // The phases the value reaches; default ["runtime"].
  scopes?: EnvDeclarationScope[];
  value?: string;
}

export interface AppSpec {
  $schema?: string;
  /*
    Everything the app is made of, by the name the project chose. Each entry
    takes type/image/root/build/start/static. One resource is supported today.
  */
  resources?: Record<string, AppResource>;
  // The variables the app expects; values live in the dashboard.
  env?: Record<string, EnvDeclaration>;
}

export function getAppSpecSchemaUrl(host: string): string {
  return `${host.replace(/\/$/, '')}/schema/${APP_SPEC_FILE_NAME}?version=${APP_SPEC_VERSION}`;
}

export function getAppSpecFilePath(cwd = process.cwd()): string {
  return join(cwd, APP_SPEC_FILE_NAME);
}

// The file's content, or null when there is none. Comments and trailing
// commas are accepted (JSONC) since the file is hand-written and annotated;
// anything else malformed is an error, because silently ignoring it would
// deploy something else.
export async function readAppSpecFile(cwd = process.cwd()): Promise<AppSpec | null> {
  let content: string;
  try {
    content = await fs.readFile(getAppSpecFilePath(cwd), 'utf8');
  } catch {
    return null;
  }
  const errors: ParseError[] = [];
  const parsed: unknown = parseJsonc(content, errors, {
    allowTrailingComma: true,
    disallowComments: false,
  });
  if (errors.length > 0) {
    throw new Error(
      `${APP_SPEC_FILE_NAME} is not valid JSON: ${describeParseError(content, errors[0])}`
    );
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${APP_SPEC_FILE_NAME} must contain a JSON object`);
  }
  return parsed as AppSpec;
}

function describeParseError(content: string, error: ParseError): string {
  const before = content.slice(0, error.offset);
  const line = before.split('\n').length;
  const column = error.offset - before.lastIndexOf('\n');
  return `${printParseErrorCode(error.error)} at line ${line}, column ${column}`;
}

export async function writeAppSpecFile(spec: AppSpec, cwd = process.cwd()): Promise<void> {
  await fs.writeFile(getAppSpecFilePath(cwd), JSON.stringify(spec, null, 2) + '\n');
}

export function formatAppSpec(spec: AppSpec): string[] {
  const lines: string[] = [];
  const entries = Object.entries(spec.resources ?? {});

  for (const [name, resource] of entries) {
    // Only label the resource when there is more than one to tell apart.
    if (entries.length > 1) {
      lines.push(`  resource: ${name}`);
    }
    lines.push(`  image:   ${resource.image ?? 'default (node-22-slim)'}`);
    if (resource.root && resource.root !== '.') {
      lines.push(`  root:    ${resource.root}`);
    }
    lines.push(...formatCommands('build', resource.build, 'default (npm install)'));
    lines.push(...formatCommands('start', resource.start, '(none)'));
    for (const mount of resource.static ?? []) {
      lines.push(`  static:  ${mount.path} -> ${mount.dir}/`);
    }
  }

  /*
    Values are not printed: a declaration carries only a name and a type, and
    the literal on a build-scoped entry is not worth the width here.
  */
  for (const [key, declaration] of Object.entries(spec.env ?? {})) {
    lines.push(`  env:     ${key} (${declaration.type ?? 'text'})`);
  }

  return lines;
}

// One line per command, in the order they run. A missing list is filled in
// by the server's default; an empty one is the user saying there is none.
function formatCommands(
  label: string,
  list: CommandList | undefined,
  whenMissing: string
): string[] {
  const prefix = `  ${`${label}:`.padEnd(8)} `;
  if (!list) {
    return [`${prefix}${whenMissing}`];
  }
  if (list.commands.length === 0) {
    return [`${prefix}(none)`];
  }
  return list.commands.map((command) => `${prefix}${command}`);
}
