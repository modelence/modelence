import {
  AGENT_SETUP_PROMPT,
  APP_SPEC_FILE_NAME,
  SETUP_DOCS_URL,
  formatAppSpec,
  readAppSpecFile,
  type AppSpec,
  type StaticMount,
} from './appSpec';
import { resolveAppRoot } from './appRoot';

/*
  modelence.config.json is the whole contract between a project and Modelence
  Cloud: the CLI reads it, checks what only the local file system can tell
  (the file exists, root is a real directory in the upload) and sends
  it on. Studio validates it against the schema and fills in the runtime's
  defaults; nothing is inferred here.
*/

const KNOWN_TOP_LEVEL_KEYS = ['$schema', 'resources', 'env'];

// Reads and checks modelence.config.json, prints the plan and returns the file's
// content for the deploy request. Throws when there is no file.
export async function prepareSpec(cwd: string): Promise<AppSpec> {
  const spec = await readAppSpecFile(cwd);
  if (!spec) {
    throw new Error(missingSpecMessage(cwd));
  }
  assertKnownKeys(spec);
  for (const resource of Object.values(spec.resources ?? {})) {
    if (resource?.root !== undefined) {
      await resolveAppRoot(cwd, resource.root);
    }
  }

  console.log(`Build plan (${APP_SPEC_FILE_NAME}):`);
  for (const line of formatAppSpec(spec)) {
    console.log(line);
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
  // uploaded. An empty build list is "no build step"; an empty command never is.
  for (const [name, resource] of Object.entries(spec.resources ?? {})) {
    for (const section of ['build', 'start'] as const) {
      const commands = resource?.[section]?.commands;
      if (!Array.isArray(commands)) {
        continue;
      }
      commands.forEach((command, index) => {
        if (typeof command === 'string' && command.trim() === '') {
          throw new Error(
            `${APP_SPEC_FILE_NAME}: "resources.${name}.${section}.commands.${index}" must not be empty.`
          );
        }
      });
    }
  }
}

// A resolved spec as the server reports it: every key present, with [] for
// no build step and null for no web process.
export interface ResolvedSpec {
  runtime: string;
  build: { image: string; root: string; commands: string[] };
  web: { start: string | null; static: StaticMount[] };
}
