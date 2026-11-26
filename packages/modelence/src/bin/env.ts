import { promises as fs } from 'fs';
import { resolve } from 'path';
import open from 'open';
import { parse as parseDotenv } from 'dotenv';
import { APP_SPEC_FILE_NAME, readAppSpecFile, type EnvDeclaration } from './appSpec';
import { findDeclaration, planEnvPush, type EnvVarChange, type EnvVarFlags } from './envPush';
import {
  openEnvironment,
  type EnvironmentOptions,
  type EnvironmentSession,
} from './environmentSession';
import { formatTable, printJson, printLine, printNote } from './output';
import { promptHidden, readStdin } from './secretInput';
import { isTransientError } from './studioApi';

/*
  `modelence env`: the environment variables of a cloud environment.

  Coding agents run these commands, and all they print or are given as
  arguments ends up in a transcript. So a secret's value is never printed and
  never taken from an argument: it comes from the dashboard (`request`), a
  local file (`push`), stdin or a hidden prompt (`set`).
*/

// Only a text variable comes with its value.
export type EnvVarSummary = TextEnvVar | SecretEnvVar | ResourceEnvVar;

interface EnvVarBase {
  key: string;
  scopes: string[];
}

interface ValueEnvVar extends EnvVarBase {
  status: 'set' | 'default' | 'missing' | 'optional';
  declared: boolean;
  updatedAt: string | null;
}

export interface TextEnvVar extends ValueEnvVar {
  kind: 'text';
  value: string | null;
}

export interface SecretEnvVar extends ValueEnvVar {
  kind: 'secret';
}

export interface ResourceEnvVar extends EnvVarBase {
  kind: 'resource';
  resource: string;
}

interface EnvList {
  variables: EnvVarSummary[];
  restartNeeded: boolean;
}

interface EnvSaved {
  saved: { key: string; secret: boolean; scopes: string[] }[];
  restartNeeded: boolean;
}

export interface EnvSetOptions extends EnvironmentOptions {
  stdin?: boolean;
  text?: boolean;
  secret?: boolean;
  scopes?: string;
}

export interface EnvPushOptions extends EnvironmentOptions {
  file: string;
  all?: boolean;
}

export interface EnvRequestOptions extends EnvironmentOptions {
  wait: boolean;
}

const REQUEST_POLL_INTERVAL_MS = 3000;
const REQUEST_TIMEOUT_MS = 10 * 60 * 1000;

export async function envList(options: EnvironmentOptions & { json?: boolean }): Promise<void> {
  const session = await openEnvironment(options);
  const result = await session.get<EnvList>('/api/cli/env');
  if (options.json) {
    printJson(result);
    return;
  }
  if (result.variables.length === 0) {
    printNote('No environment variables.');
    return;
  }
  const rows = result.variables.map((variable) => [
    variable.key,
    describeStatus(variable),
    variable.scopes.join('+'),
    describeValue(variable),
  ]);
  formatTable([['NAME', 'STATUS', 'SCOPES', 'VALUE'], ...rows]).forEach((line) => printLine(line));
  noteRestart(result.restartNeeded, options);
}

function describeStatus(variable: EnvVarSummary): string {
  if (variable.kind === 'resource') {
    return 'resource';
  }
  return variable.status === 'missing' ? 'not set' : variable.status;
}

function describeValue(variable: EnvVarSummary): string {
  if (variable.kind === 'resource') {
    return `from ${variable.resource}`;
  }
  if (variable.kind === 'text') {
    return variable.value ?? '';
  }
  const hasValue = variable.status === 'set' || variable.status === 'default';
  return hasValue ? '(secret)' : '';
}

export async function envSet(entries: string[], options: EnvSetOptions): Promise<void> {
  const requested = parseFlags(options);
  const parsed = parseEntries(entries, options);
  // Every name is checked before a value is asked for or anyone signs in.
  const declarations = await readDeclarations();
  const named = parsed.map((entry) => ({
    ...entry,
    requested,
    ...declarationOf(declarations, entry.key),
  }));
  const changes: EnvVarChange[] = [];
  for (const entry of named) {
    changes.push({ ...entry, value: entry.value ?? (await readValue(entry.key, options)) });
  }
  await save(await openEnvironment(options), changes, options);
}

function parseFlags({ text, secret, scopes }: EnvSetOptions): EnvVarFlags {
  if (text && secret) {
    throw new Error('Pass --text or --secret, not both.');
  }
  const list = scopes?.split(',').map((scope) => scope.trim());
  const unknown = list?.find((scope) => scope !== 'build' && scope !== 'runtime');
  if (unknown !== undefined) {
    throw new Error(`--scopes takes build, runtime or build,runtime, not "${unknown}".`);
  }
  return {
    ...(text || secret ? { secret: Boolean(secret) } : {}),
    ...(list ? { scopes: list as EnvVarFlags['scopes'] } : {}),
  };
}

// A name without a value still has to be asked for one.
type EnvEntry = Pick<EnvVarChange, 'key' | 'plainOnly'> & { value?: string };

function parseEntries(entries: string[], options: EnvSetOptions): EnvEntry[] {
  const inline = entries.filter((entry) => entry.includes('='));
  if (inline.length === entries.length) {
    if (options.stdin) {
      throw new Error('With --stdin, pass only the name; the value is read from stdin.');
    }
    // The value is not repeated: it may be the secret that shouldn't be here.
    if (options.secret) {
      throw new Error(
        'A secret can\'t be given as NAME=value. Use "modelence env request", --stdin or the prompt.'
      );
    }
    return inline.map((entry) => {
      const separator = entry.indexOf('=');
      return {
        key: entry.slice(0, separator),
        value: entry.slice(separator + 1),
        plainOnly: true,
      };
    });
  }
  if (entries.length > 1) {
    throw new Error('Set one name at a time, or several as NAME=value.');
  }
  return [{ key: entries[0] }];
}

async function readValue(key: string, options: EnvSetOptions): Promise<string> {
  const value = options.stdin ? await readStdin() : await promptValue(key);
  if (value === '') {
    throw new Error(`No value given for ${key}.`);
  }
  return value;
}

async function promptValue(key: string): Promise<string> {
  if (!process.stdin.isTTY) {
    throw new Error(
      `Use "modelence env request ${key}" to enter the value in the browser, or pipe it in with --stdin.`
    );
  }
  return await promptHidden(`Value for ${key} (hidden): `);
}

export async function envPush(options: EnvPushOptions): Promise<void> {
  const declarations = await readDeclarations();
  if (!declarations && !options.all) {
    throw new Error(
      `There is no ${APP_SPEC_FILE_NAME} here to say which variables the app uses. Pass --all to push every variable in the file.`
    );
  }
  const path = resolve(process.cwd(), options.file);
  const content = await fs.readFile(path, 'utf8').catch((error: NodeJS.ErrnoException) => {
    throw new Error(`Could not read ${options.file} (${error.code ?? error.message}).`);
  });
  const plan = planEnvPush(parseDotenv(content), declarations ?? {}, Boolean(options.all));
  for (const { key, reason } of plan.skipped) {
    printNote(`Skipped ${key}: ${reason}`);
  }
  if (plan.changes.length === 0) {
    throw new Error(`Nothing to push from ${options.file}.`);
  }
  const session = await openEnvironment(options);
  await save(session, plan.changes, options);
}

export async function envRemove(keys: string[], options: EnvironmentOptions): Promise<void> {
  const session = await openEnvironment(options);
  const { removed, restartNeeded } = await session.post<{
    removed: string[];
    restartNeeded: boolean;
  }>('/api/cli/env/remove', { keys });
  printLine(`Removed ${removed.join(', ')}`);
  noteRestart(restartNeeded, options);
}

// Sends a person to the dashboard for the values, and waits for them.
export async function envRequest(names: string[], options: EnvRequestOptions): Promise<void> {
  // As for `env set`, a resource name is refused before anyone signs in.
  const declarations = await readDeclarations();
  names.forEach((key) => declarationOf(declarations, key));
  const session = await openEnvironment(options);
  const before = await session.get<EnvList>('/api/cli/env');
  const keys =
    names.length > 0
      ? names
      : before.variables.flatMap((variable) =>
          variable.kind !== 'resource' &&
          variable.status === 'missing' &&
          findDeclaration(declarations, variable.key)?.type !== 'resource'
            ? [variable.key]
            : []
        );
  if (keys.length === 0) {
    printLine('Every required variable has a value.');
    return;
  }
  const { url } = await session.post<{ url: string }>(
    '/api/cli/env/request',
    requestBody(keys, declarations)
  );
  printLine(`Enter ${keys.join(', ')} at ${url}`);
  if (!options.wait) {
    return;
  }
  if (isOnHost(url, session.host)) {
    try {
      await open(url);
    } catch {
      // No browser here; the link is already printed.
    }
  }
  await waitForValues(session, keys, before.variables, options);
}

/*
  The names, with how the local modelence.config.json declares them. It can be
  ahead of the deployed file: without this, a name added there would be stored
  as a runtime-only secret, and the next build would run without it.
*/
function requestBody(
  keys: string[],
  declarations: Record<string, EnvDeclaration> | null
): { keys: string[]; declarations?: Record<string, EnvVarChange['declaration']> } {
  const declared = keys.flatMap((key) => {
    const { declaration } = declarationOf(declarations, key);
    return declaration ? [[key, declaration] as const] : [];
  });
  return declared.length > 0 ? { keys, declarations: Object.fromEntries(declared) } : { keys };
}

// Only a page of the Studio in use is opened; any other link is just printed.
export function isOnHost(url: string, host: string): boolean {
  return URL.canParse(url) && new URL(url).origin === new URL(host).origin;
}

async function waitForValues(
  session: EnvironmentSession,
  keys: string[],
  before: EnvVarSummary[],
  options: EnvironmentOptions
): Promise<void> {
  const deadline = Date.now() + REQUEST_TIMEOUT_MS;
  let waiting = keys;
  while (Date.now() < deadline) {
    await new Promise((done) => setTimeout(done, REQUEST_POLL_INTERVAL_MS));
    const list = await fetchListIfReachable(session);
    if (!list) {
      continue;
    }
    const { variables, restartNeeded } = list;
    const saved = waiting.filter((key) => isSavedSince(key, before, variables));
    saved.forEach((key) => printLine(`${key}: set`));
    waiting = waiting.filter((key) => !saved.includes(key));
    if (waiting.length === 0) {
      noteRestart(restartNeeded, options);
      return;
    }
  }
  throw new Error(
    `Still no new value for ${waiting.join(', ')} after 10 minutes. The link keeps working; "modelence env list" shows what is set.`
  );
}

// Null when Studio can't be reached just now: the person is still typing.
async function fetchListIfReachable(session: EnvironmentSession): Promise<EnvList | null> {
  try {
    return await session.get<EnvList>('/api/cli/env');
  } catch (error) {
    if (isTransientError(error)) {
      return null;
    }
    throw error;
  }
}

// A value saved again counts, so an existing one can be replaced this way.
export function isSavedSince(
  key: string,
  before: EnvVarSummary[],
  after: EnvVarSummary[]
): boolean {
  const savedAt = (variables: EnvVarSummary[]) => {
    const variable = variables.find((candidate) => candidate.key === key);
    return variable && variable.kind !== 'resource' && variable.status === 'set'
      ? variable.updatedAt
      : null;
  };
  const current = savedAt(after);
  return current !== null && current !== savedAt(before);
}

async function save(
  session: EnvironmentSession,
  variables: EnvVarChange[],
  options: EnvironmentOptions
): Promise<void> {
  const { saved, restartNeeded } = await session.post<EnvSaved>('/api/cli/env', { variables });
  for (const { key, secret, scopes } of saved) {
    printLine(`Set ${key} (${secret ? 'secret' : 'text'}, ${scopes.join('+')})`);
  }
  if (saved.some(({ scopes }) => scopes.includes('build'))) {
    printNote('Build variables reach the app with its next deploy.');
  }
  noteRestart(restartNeeded, options);
}

function noteRestart(restartNeeded: boolean, { app, env, host }: EnvironmentOptions): void {
  if (restartNeeded) {
    const target = [app ? `--app ${app}` : null, `--env ${env}`, host ? `--host ${host}` : null]
      .filter(Boolean)
      .join(' ');
    printNote(`Restart to apply runtime variables: npx modelence@latest restart ${target}`);
  }
}

async function readDeclarations(): Promise<Record<string, EnvDeclaration> | null> {
  const spec = await readAppSpecFile();
  return spec ? (spec.env ?? {}) : null;
}

function declarationOf(
  declarations: Record<string, EnvDeclaration> | null,
  key: string
): Pick<EnvVarChange, 'declaration'> {
  const declaration = findDeclaration(declarations, key);
  if (!declaration) {
    return {};
  }
  if (declaration.type === 'resource') {
    throw new Error(
      `${key} comes from the resource "${declaration.resource}" in ${APP_SPEC_FILE_NAME} and can't be set.`
    );
  }
  return { declaration: { type: declaration.type, scopes: declaration.scopes } };
}
