import { promises as fs } from 'fs';
import { join } from 'path';
import { applyEdits, modify, parse, type ParseError } from 'jsonc-parser';
import { APP_SPEC_FILE_NAME } from './appSpec';

/*
  VS Code (and editors built on it, like Cursor) only downloads JSON Schemas
  from trusted domains; the schema modelence.config.json points at on
  cloud.modelence.com is refused as "untrusted" until the project's settings
  trust it. This adds the Modelence host to .vscode/settings.json, editing
  the file in place so its comments and formatting survive, and never
  touching a file it cannot parse.
*/

const TRUSTED_DOMAINS_SETTING = 'json.schemaDownload.trustedDomains';

export type TrustResult = 'added' | 'present' | 'skipped';

export async function trustSchemaHost(
  cwd: string,
  host: string,
  // Create .vscode/settings.json when the project has none (init); otherwise
  // only add to a VS Code setup the project already has (deploy).
  { create }: { create: boolean }
): Promise<TrustResult> {
  const domain = `${new URL(host).origin}/`;
  const vscodeDir = join(cwd, '.vscode');
  const settingsPath = join(vscodeDir, 'settings.json');

  let content: string | null = null;
  try {
    content = await fs.readFile(settingsPath, 'utf8');
  } catch {
    // No settings file yet.
  }

  if (content === null) {
    if (!create && !(await exists(vscodeDir))) {
      return 'skipped';
    }
    await fs.mkdir(vscodeDir, { recursive: true });
    await fs.writeFile(
      settingsPath,
      JSON.stringify({ [TRUSTED_DOMAINS_SETTING]: { [domain]: true } }, null, 2) + '\n'
    );
    return 'added';
  }

  const errors: ParseError[] = [];
  const settings = parse(content, errors, { allowTrailingComma: true });
  if (errors.length > 0 || !settings || typeof settings !== 'object' || Array.isArray(settings)) {
    return 'skipped';
  }
  if (settings[TRUSTED_DOMAINS_SETTING]?.[domain] === true) {
    return 'present';
  }
  const edits = modify(content, [TRUSTED_DOMAINS_SETTING, domain], true, {
    formattingOptions: { insertSpaces: true, tabSize: 2 },
  });
  await fs.writeFile(settingsPath, applyEdits(content, edits));
  return 'added';
}

async function exists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

// The Studio host a $schema URL points at, when it is the Modelence schema.
export function getSchemaHost(schemaUrl: unknown): string | null {
  if (typeof schemaUrl !== 'string') {
    return null;
  }
  try {
    const url = new URL(schemaUrl);
    return url.pathname === `/schema/${APP_SPEC_FILE_NAME}` ? url.origin : null;
  } catch {
    return null;
  }
}

// trustSchemaHost for the commands: says what it changed, and a failure is
// only a warning, since editor support is never worth failing a command for.
export async function ensureSchemaHostTrusted(
  cwd: string,
  host: string,
  options: { create: boolean }
): Promise<void> {
  try {
    if ((await trustSchemaHost(cwd, host, options)) === 'added') {
      console.log(
        `Trusted ${new URL(host).origin} in .vscode/settings.json so VS Code can load the ${APP_SPEC_FILE_NAME} schema.`
      );
    }
  } catch (error) {
    console.warn('Could not update .vscode/settings.json:', error);
  }
}
