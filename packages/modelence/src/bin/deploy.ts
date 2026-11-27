import { createWriteStream, promises as fs } from 'fs';
import { join } from 'path';
import archiver from 'archiver';
import { loadEnv, getProjectPath } from './config';
import { otherAppHosts, projectForHost, readProject } from './project';
import { packSource } from './source';
import { build } from './build';
import { prepareSpec } from './deploySpec';
import { describeDeployKind, resolveDeployKind } from './deployKind';
import { getServices, readAppSpecFile, type AppSpec } from './appSpec';
import { describeOtherHosts, type CliTarget } from './deployTarget';
import { isCI } from './terminal';
import type { AppRef } from './authCache';
import {
  assertEnvTokenHost,
  resolveHost,
  resolveLogin,
  rememberApp,
  isUnauthorized,
  type Session,
} from './deploySession';
import { appRefFor } from './environmentSession';
import { runDeploy, type StartedDeploy, type UploadKind } from './deployUpload';
import { readSourceRevision } from './revision';
import { followDeploy } from './deployStatus';
import { signIn, signInAgain, SignInRequiredError } from './signIn';

/*
  `modelence deploy`: ship the current directory to a Modelence Cloud
  environment.

  Default path — any Node.js app: the source tree is uploaded and built
  remotely as the project's modelence.config.json describes. Studio resolves that
  file against the defaults of its runtime and nothing else. The CLI amends
  it in one case only: a Modelence framework app gets the MongoDB and
  Elastic it always needs when the file leaves them out (deploySpec.ts). `--prebuilt` keeps the historical
  Modelence path: build locally, upload .modelence/build — and so does a
  Modelence framework app that has no modelence.config.json, so projects that
  deployed before the file existed keep deploying unchanged (deployKind.ts).

  Target: always named, with --env, plus --app unless .modelence/project.json
  records the app. The environment is never remembered: project.json is
  committed, and the same code goes to several environments (staging,
  production), so a deploy must say which.

  Login: the app's saved login (signIn.ts), approved once in the browser for
  the environments and access chosen there. With it, deploys run without a
  browser, which is what lets an agent deploy unattended. Without one, the
  sign-in comes before the build, so in an agent's shell, where the command
  stops at the link, nothing is built for nothing. A project with no app yet
  gets one picked (or created) on that page, and recorded.

  Studio refuses a deploy while a variable modelence.config.json requires
  has no value, naming the ways to set it (--skip-env-check deploys anyway).

  CI: the browser is never opened. The token comes from MODELENCE_TOKEN, and
  a missing one fails at once instead of waiting for an approval nobody will
  give.
*/

export interface DeployOptions {
  app?: string;
  env?: string;
  host?: string;
  prebuilt?: boolean;
  skipEnvCheck?: boolean;
  // Rebuild and roll out every service, not only the ones that changed.
  rebuildAll?: boolean;
}

export async function deploy(options: DeployOptions) {
  const cwd = process.cwd();
  const host = await resolveHost(options.host, cwd);
  assertEnvTokenHost(options.host, host);
  const decision = await resolveDeployKind(cwd, options);
  const kind: UploadKind = decision.kind;
  const kindNote = describeDeployKind(decision);
  if (kindNote) {
    console.log(kindNote);
  }
  const savedProject = await readProject(cwd);
  const project = projectForHost(savedProject, host);
  // An app saved for another Studio doesn't apply here, but say so: an app
  // picker or a "pass --app" out of the blue would be a puzzle.
  const otherHosts = project.appId ? [] : otherAppHosts(savedProject, host);
  const envAlias = options.env;
  if (!envAlias) {
    throw new Error(
      'Pass --env <environment> to say where to deploy, e.g. --env production. ' +
        'Deploys never pick the environment for you.'
    );
  }
  const app = appRefFor(options, project);
  const ci = isCI();
  const canSignIn = !ci && !process.env.MODELENCE_TOKEN;
  if (!app.appId && !app.appAlias && !canSignIn) {
    throw new Error(nonInteractiveMessage(Boolean(process.env.MODELENCE_TOKEN), otherHosts));
  }
  if (!app.appId && !app.appAlias && otherHosts.length > 0) {
    console.log(
      `Note: ${describeOtherHosts(otherHosts)} Pick the app for ${host} in the browser, or pass --host to deploy there.`
    );
  }

  // A missing or invalid modelence.config.json stops here, before anyone is
  // asked to sign in. A --prebuilt deploy still sends the file when there is
  // one, for its variable declarations.
  const spec: AppSpec | undefined =
    kind === 'bundle' ? ((await readAppSpecFile(cwd)) ?? undefined) : await prepareSpec(cwd);

  const login = await ensureLogin(host, {
    app,
    envAlias,
    canSignIn,
    otherHosts,
    services: getDeclaredServices(kind, spec),
  });
  const appId = app.appId ?? login.appId;
  // Also drops the environment earlier CLIs saved next to the app.
  if (login.appId && (!project.appId || project.appId === login.appId)) {
    await rememberApp(login.appId, host);
  }
  const target = deployTarget(app, appId, envAlias);

  // Before the build and archive are written into the project.
  const revision = await readSourceRevision(cwd);
  const archivePath = join(cwd, '.modelence', 'tmp', `${kind}.zip`);
  if (kind === 'bundle') {
    await loadEnv();
    await build();
    await createBundle(archivePath);
  } else {
    reportPackedSource(await packSource(cwd, archivePath));
  }

  try {
    const session: Session = { host, token: login.token };
    /*
      Studio rejected the login: it expired, was revoked, or doesn't cover
      this environment (or only reads it). Sign in once more. The deploy
      itself is never repeated — an upload that failed authentication did
      not start anything, and a build already running is simply followed
      again.
    */
    const renewSession = async (reason?: string) => {
      session.token = await signInAgain(host, {
        app: appId ? { appId } : app,
        envAlias,
        canSignIn,
        reason,
        refusal:
          'CI deploys never sign in again in the browser. Set a MODELENCE_TOKEN that covers this environment. ' +
          'A deployment that already started keeps running; check the dashboard.',
      });
    };

    const start = () =>
      runDeploy({
        session,
        target,
        kind,
        archivePath,
        spec,
        checkEnv: !options.skipEnvCheck,
        rebuildAll: options.rebuildAll ?? false,
        revision,
      });
    let started: StartedDeploy;
    try {
      started = await start();
    } catch (error) {
      if (!isUnauthorized(error)) {
        throw error;
      }
      await renewSession(error instanceof Error ? error.message : undefined);
      started = await start();
    }
    if (started.buildId) {
      const { buildId } = started;
      await followDeploy(
        session,
        () =>
          renewSession().catch((error: unknown) => explainRunningBuild(error, buildId, envAlias)),
        started.environmentId,
        buildId
      );
    }
  } finally {
    await fs.rm(archivePath, { force: true });
  }
}

async function ensureLogin(
  host: string,
  {
    app,
    envAlias,
    canSignIn,
    otherHosts,
    services,
  }: {
    app: AppRef;
    envAlias: string;
    canSignIn: boolean;
    otherHosts: string[];
    services?: string[];
  }
): Promise<{ token: string; appId?: string }> {
  const saved = await resolveLogin(host, app);
  if (saved) {
    return saved;
  }
  if (!canSignIn) {
    throw new Error(nonInteractiveMessage(false, otherHosts));
  }
  const login = await signIn(host, { app, envAlias, services });
  return { token: login.token, appId: login.appId };
}

function deployTarget(app: AppRef, appId: string | undefined, envAlias: string): CliTarget {
  if (app.appAlias) {
    return { appAlias: app.appAlias, envAlias };
  }
  if (appId) {
    return { appId, envAlias };
  }
  // Without an app, the login comes from a sign-in, which always names one.
  throw new Error('No app to deploy to. Pass --app.');
}

/*
  The login stopped working while a build runs. Running the same command
  again, as a sign-in normally asks, would start a second deploy of the same
  code, so the message says to follow this one instead.
*/
function explainRunningBuild(error: unknown, buildId: string, envAlias: string): never {
  if (!(error instanceof SignInRequiredError)) {
    throw error;
  }
  throw new Error(
    `The deploy already started (build ${buildId}) and keeps running; do not deploy again. ` +
      `Sign in at ${error.verificationUrl}, then follow it with ` +
      `\`npx modelence@latest builds logs --env ${envAlias}\`.`
  );
}

function nonInteractiveMessage(hasToken: boolean, otherHosts: string[]): string {
  const hostNote =
    otherHosts.length > 0
      ? ` Note: ${describeOtherHosts(otherHosts)} Pass --host to deploy there.`
      : '';
  if (hasToken) {
    return `CI deploys never open the browser to pick the app. Pass --app, or record the app in .modelence/project.json.${hostNote}`;
  }
  return `CI deploys never open the browser to sign in. Set MODELENCE_TOKEN.${hostNote}`;
}

const LISTED_PATHS_LIMIT = 10;

function formatPaths(paths: string[]): string {
  const shown = paths.slice(0, LISTED_PATHS_LIMIT).join(', ');
  const more = paths.length - LISTED_PATHS_LIMIT;
  return more > 0 ? `${shown} and ${more} more` : shown;
}

// What went into the upload and, by name, everything that did not or that
// might surprise: the cloud build sees only what is listed as packed.
function reportPackedSource(packed: Awaited<ReturnType<typeof packSource>>): void {
  console.log(
    `Packed ${packed.fileCount} files (${formatMb(packed.sizeBytes)})` +
      (packed.usedGit ? ' from git' : '; not a git repository, so only default exclusions applied')
  );
  if (packed.excludedFiles.length > 0) {
    console.log(
      `Not uploaded (local, generated or credentials; store secrets in the target environment): ${formatPaths(packed.excludedFiles)}`
    );
  }
  if (packed.committedEnvFiles.length > 0) {
    console.log(
      `Uploaded environment files committed to git: ${formatPaths(packed.committedEnvFiles)}`
    );
  }
  for (const { path, reason } of packed.skipped) {
    console.warn(`Warning: ${path} is not uploaded (${reason}).`);
  }
}

function formatMb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

// The historical --prebuilt bundle: build output plus the manifests the
// container needs to install production dependencies.
async function createBundle(bundlePath: string) {
  await fs.rm(bundlePath, { force: true });
  console.log('Creating deployment bundle...');
  await fs.mkdir(join(bundlePath, '..'), { recursive: true });

  const output = createWriteStream(bundlePath);
  const archive = archiver('zip', { zlib: { level: 9 } });
  const archiveComplete = new Promise<void>((resolve, reject) => {
    output.on('close', resolve);
    output.on('error', reject);
    archive.on('error', reject);
  });
  archive.pipe(output);

  const bundleFiles = [
    'package.json',
    'package-lock.json',
    'next.config.js',
    'next.config.ts',
    'modelence.config.ts',
  ];
  const bundleDirs = ['public', 'server', 'scripts', join('.modelence', 'build'), '.next'];

  for (const file of bundleFiles) {
    if (await pathExists(getProjectPath(file))) {
      archive.file(getProjectPath(file), { name: file });
    }
  }
  for (const dir of bundleDirs) {
    if (await pathExists(getProjectPath(dir))) {
      archive.directory(getProjectPath(dir), dir);
    }
  }

  await archive.finalize();
  await archiveComplete;

  const stats = await fs.stat(bundlePath);
  console.log(`Deployment bundle created (${formatMb(stats.size)})`);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

/*
  The sign-in page sizes a new environment for these. Studio builds a
  --prebuilt bundle as one service whatever the file declares, so a bundle
  sends none and the page counts one container.
*/
function getDeclaredServices(kind: UploadKind, spec: AppSpec | undefined): string[] | undefined {
  return kind === 'source' && spec ? getServices(spec).map(([name]) => name) : undefined;
}
