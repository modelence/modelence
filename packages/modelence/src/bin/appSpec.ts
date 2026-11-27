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
export type ManagedResourceType = 'postgres' | 'redis' | 'telemetry';
export type PlatformResourceType = 'mongodb' | 'elastic';
export type ResourceType = 'service' | ManagedResourceType | PlatformResourceType;

export interface StaticMount {
  path: string;
  dir: string;
}

// Commands run one after another; one failing stops the rest.
export interface CommandList {
  commands: string[];
}

export type ServiceHealthCheck =
  | { type: 'tcp'; gracePeriod?: number }
  | { type: 'http'; path: string; gracePeriod?: number }
  | { type: 'none' };

export type ServiceRollout = 'overlap' | 'recreate';

// The keys every service takes, however its image is built.
interface ServiceResourceBase {
  type: 'service';
  root?: string;
  start?: CommandList;
  // What `modelence dev` runs locally; never deployed. Missing means the
  // package.json `dev` script in root.
  dev?: CommandList;
  healthCheck?: ServiceHealthCheck;
  rollout?: ServiceRollout;
  // Seconds between SIGTERM and SIGKILL when a container stops.
  stopTimeout?: number;
  /*
    The ports the process listens on, main port first: the container gets
    it as PORT and the health check probes it. A Node.js service's main
    port is 3000. Missing means [3000]. Which hostname goes to which port is
    set in the dashboard.
  */
  ports?: number[];
  /*
    Files and folders, relative to the project root, whose changes rebuild
    this service. Missing means every deploy rebuilds it; with a list, only
    changes under these paths do, with nothing added on top.
  */
  watchPaths?: string[];
}

/*
  Built on a Node.js image with the build commands, listening on PORT. A
  client-only site is a service without `start`, serving its `static` mounts.
*/
export interface NodeServiceResource extends ServiceResourceBase {
  // node-<version>-<variant>, e.g. "node-22-slim" or "node-22.23.1-alpine".
  image?: string;
  build?: CommandList;
  static?: StaticMount[];
  dockerfile?: never;
}

/*
  Built from the project's own Dockerfile, relative to `root`, which is the
  build context. `start`, when set, replaces its ENTRYPOINT and CMD.
*/
export interface DockerfileServiceResource extends ServiceResourceBase {
  dockerfile: string;
  image?: never;
  build?: never;
  static?: never;
}

export type ServiceResource = NodeServiceResource | DockerfileServiceResource;

export function isDockerfileService(
  resource: ServiceResource
): resource is DockerfileServiceResource {
  return resource.dockerfile !== undefined;
}

// A database, cache or telemetry ingest the deploy creates in the environment.
export interface ManagedResource {
  type: ManagedResourceType;
  // Deprecated: the size is picked in the browser on the deploy that creates
  // it. When set, a plan name such as "postgres-1gb". Telemetry has no plans.
  plan?: string;
}

/*
  The platform's MongoDB database or Elastic metrics storage. Unlike a
  managed resource it has no plan and no outputs. Other apps get one only
  when the file declares it; a Modelence framework app always gets both,
  since `modelence deploy` adds the ones its file leaves out
  (addFrameworkResources) and a build without a file gets them from Studio.
*/
export interface PlatformResource {
  type: PlatformResourceType;
}

export type AppResource = ServiceResource | ManagedResource | PlatformResource;

// Checked by name: the CLI reads the file before Studio validates it, so a
// missing or misspelled type must not pass as a managed resource.
export function isManagedResource(resource: AppResource): resource is ManagedResource {
  return resource.type === 'postgres' || resource.type === 'redis' || resource.type === 'telemetry';
}

export function isPlatformResource(resource: AppResource): resource is PlatformResource {
  return resource.type === 'mongodb' || resource.type === 'elastic';
}

// Everything else is a service, so an entry with a missing or misspelled
// type is sent on as one and Studio reports it.
export function isServiceResource(resource: AppResource): resource is ServiceResource {
  return !isManagedResource(resource) && !isPlatformResource(resource);
}

// The resources that run as containers, by name, in the file's order.
export function getServices(spec: AppSpec): (readonly [string, ServiceResource])[] {
  return Object.entries(spec.resources ?? {}).flatMap(([name, resource]) =>
    isServiceResource(resource) ? [[name, resource] as const] : []
  );
}

const FRAMEWORK_RESOURCES = [
  ['mongodb', 'db'],
  ['elastic', 'metrics'],
] as const;

/*
  A Modelence framework app always keeps its data in the platform's MongoDB
  and sends its metrics to Elastic, so the spec a deploy sends declares both
  even when the file leaves them out. Only the sent spec changes, never the
  file. Returns the names of the entries it added.
*/
export function addFrameworkResources(spec: AppSpec): { spec: AppSpec; added: string[] } {
  const resources = { ...(spec.resources ?? {}) };
  const added: string[] = [];
  for (const [type, baseName] of FRAMEWORK_RESOURCES) {
    if (Object.values(resources).some((resource) => resource?.type === type)) {
      continue;
    }
    let name: string = baseName;
    for (let suffix = 2; name in resources; suffix++) {
      name = `${baseName}-${suffix}`;
    }
    resources[name] = { type };
    added.push(name);
  }
  return { spec: added.length > 0 ? { ...spec, resources } : spec, added };
}

export interface ValueEnvDeclaration {
  type?: EnvDeclarationType;
  // The phases the value reaches; default ["runtime"].
  scopes?: EnvDeclarationScope[];
  value?: string;
  // False for a variable the app runs without; a declaration is required by default.
  required?: boolean;
}

// A variable whose value is one output of a managed resource, e.g. main-db's url.
export interface ResourceEnvDeclaration {
  type: 'resource';
  resource: string;
  output: string;
}

export type EnvDeclaration = ValueEnvDeclaration | ResourceEnvDeclaration;

export interface AppSpec {
  $schema?: string;
  /*
    Everything the app is made of, by the name the project chose: services
    (type/image/root/build/start/static, or a dockerfile; up to 5) and the
    postgres, redis and telemetry resources a deploy creates (type/plan), and
    the platform's mongodb and elastic (type).
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
  const services = getServices(spec);

  for (const [name, resource] of services) {
    // Only label the service when there is more than one to tell apart.
    if (services.length > 1) {
      lines.push(`  resource: ${name}`);
    }
    lines.push(...formatService(resource));
  }

  for (const [name, resource] of entries) {
    if (resource.type === 'telemetry') {
      lines.push(`  telemetry: ${name}`);
    } else if (isPlatformResource(resource)) {
      const label = resource.type === 'mongodb' ? 'db:' : 'metrics:';
      lines.push(`  ${label.padEnd(8)} ${name} (${resource.type})`);
    } else if (isManagedResource(resource)) {
      lines.push(
        `  db:      ${name} (${[resource.type, resource.plan].filter(Boolean).join(', ')})`
      );
    }
  }

  /*
    Values are not printed: a declaration carries only a name and a type, and
    the literal on a build-scoped entry is not worth the width here.
  */
  for (const [key, declaration] of Object.entries(spec.env ?? {})) {
    const kind =
      declaration.type === 'resource'
        ? `${declaration.resource}.${declaration.output}`
        : (declaration.type ?? 'text');
    lines.push(`  env:     ${key} (${kind})`);
  }

  return lines;
}

/*
  A Dockerfile service has no image or build of the Node.js runtime to show,
  and without `start` it runs its Dockerfile's own CMD rather than nothing.
*/
function formatService(resource: ServiceResource): string[] {
  const root = resource.root && resource.root !== '.' ? [`  root:    ${resource.root}`] : [];
  const watch = resource.watchPaths ? [`  watch:   ${resource.watchPaths.join(', ')}`] : [];
  const ports = resource.ports ? [`  ports:   ${resource.ports.join(', ')}`] : [];
  const lines = isDockerfileService(resource)
    ? [
        ...root,
        `  dockerfile: ${resource.dockerfile}`,
        ...formatCommands('start', resource.start, "(the Dockerfile's CMD)"),
      ]
    : [
        `  image:   ${resource.image ?? 'default (node-22-slim)'}`,
        ...root,
        ...formatCommands('build', resource.build, 'default (npm install)'),
        ...formatCommands('start', resource.start, '(none)'),
        ...(resource.static ?? []).map((mount) => `  static:  ${mount.path} -> ${mount.dir}/`),
      ];
  return [...lines, ...ports, ...watch];
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
