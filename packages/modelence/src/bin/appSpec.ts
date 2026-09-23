import { promises as fs } from 'fs';
import { join } from 'path';
import { parse as parseJsonc, printParseErrorCode, type ParseError } from 'jsonc-parser';

/*
  modelence.config.json — how the project is built and run on Modelence Cloud. The
  CLI reads it as-is and sends it to Studio, which validates it against the
  schema published at /schema/modelence.config.json and fills in the defaults.
  The types here mirror that schema; the server is the authority.

  For build.command and web.start: a missing key inherits the runtime
  default, null means "none" (no build step / no process), and an empty
  string is invalid.
*/

export const APP_SPEC_FILE_NAME = 'modelence.config.json';

// The file is written by the user's coding agent from the hosted setup
// guide; Mintlify serves the same page raw at the .md URL for agents.
export const SETUP_DOCS_URL = 'https://docs.modelence.com/deploy/setup';
export const AGENT_SETUP_PROMPT = `Use ${SETUP_DOCS_URL}.md to set up Modelence deployment for this project`;

export type EnvDeclarationType = 'text' | 'secret';
export type EnvVarScope = 'runtime' | 'build-and-runtime';

export interface StaticMount {
  path: string;
  dir: string;
}

/*
  A client-only site is a resource with `"start": null` and its `static`
  mounts. There is no `type`: every resource runs through the same runtime.
*/
export interface AppResource {
  build?: {
    node?: string;
    root?: string;
    install?: string;
    command?: string | null;
  };
  start?: string | null;
  static?: StaticMount[];
}

export interface EnvDeclaration {
  type?: EnvDeclarationType;
  scope?: EnvVarScope;
  value?: string;
}

export interface AppSpec {
  $schema?: string;
  /*
    Everything the app is made of, by the name the project chose. Each entry
    takes build/start/static. One resource is supported today.
  */
  resources?: Record<string, AppResource>;
  // The variables the app expects; values live in the dashboard.
  env?: Record<string, EnvDeclaration>;
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
    lines.push(`  node:    ${resource.build?.node ?? 'default (22)'}`);
    if (resource.build?.root && resource.build.root !== '.') {
      lines.push(`  root:    ${resource.build.root}`);
    }
    lines.push(`  install: ${resource.build?.install ?? 'default'}`);
    lines.push(`  build:   ${formatCommand(resource.build?.command)}`);
    lines.push(`  start:   ${formatCommand(resource.start)}`);
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

// A missing command is filled in by the runtime's default on the server;
// null is the user saying there is none.
function formatCommand(command: string | null | undefined): string {
  if (command === undefined) {
    return 'default';
  }
  if (command === null || command === '') {
    return '(none)';
  }
  return command;
}
