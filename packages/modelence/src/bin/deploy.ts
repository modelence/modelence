import { createWriteStream, promises as fs } from 'fs';
import { join } from 'path';
import { parse as parseDotenv } from 'dotenv';
import archiver from 'archiver';
import { authenticateCli, type CliAuthTarget } from './auth';
import { clearCachedToken, readCachedToken, writeCachedToken } from './authCache';
import { detectBuildPlan } from './detect';
import { loadEnv, getProjectPath } from './config';
import { readProject, updateProject, type DeployTarget } from './project';
import { packSource } from './source';
import { StudioApiError, studioRequest } from './studioApi';
import { build } from './build';

/*
  `modelence deploy`: ship the current directory to a Modelence Cloud
  environment.

  Default path — any Node.js app: the source tree is uploaded and built
  remotely (install → build → start commands detected here, overridable with
  flags, stored on the environment). `--prebuilt` keeps the historical
  Modelence path: build locally, upload .modelence/build.

  Target: -a/-e flags → --env with the app recorded in project.json → the
  deploy target recorded in project.json → the browser picker. Auth: the
  MODELENCE_TOKEN variable → the cached token → the browser.
*/

const DEFAULT_HOST = 'https://cloud.modelence.com';
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 30 * 60 * 1000;
const PROVISION_TIMEOUT_MS = 10 * 60 * 1000;

export interface DeployOptions {
  app?: string;
  env?: string;
  host?: string;
  prebuilt?: boolean;
  preset?: string;
  nodeVersion?: string;
  rootDir?: string;
  installCommand?: string;
  buildCommand?: string;
  startCommand?: string;
  outputDir?: string;
}

type CliTarget =
  | { environmentId: string }
  | { appAlias: string; envAlias: string }
  | { appId: string; envAlias: string };

type UploadKind = 'bundle' | 'source';

interface BuildPlanInput {
  preset?: string;
  nodeVersion?: string;
  rootDirectory?: string;
  installCommand?: string;
  buildCommand?: string;
  startCommand?: string;
  outputDirectory?: string;
}

interface DeployStatus {
  status: string;
  errors: string[];
  rolloutProgress: { updatedCount: number; totalCount: number } | null;
  logs: string[];
  logCount: number;
  siteUrl: string | null;
  // Last output of the containers a failed rollout tried to start.
  containerLogs?: string[];
}

// The token in use, shared so a re-authorization mid-deploy reaches every
// later request without threading a new value through each call.
interface Session {
  host: string;
  token: string;
}

export async function deploy(options: DeployOptions) {
  const cwd = process.cwd();
  const host = await resolveHost(options.host, cwd);
  const kind: UploadKind = options.prebuilt ? 'bundle' : 'source';
  const overrides = planOverrides(options);
  const project = await readProject(cwd);

  // Local work first, so nothing is uploaded when it fails.
  let detected: BuildPlanInput | undefined;
  const archivePath = join(cwd, '.modelence', 'tmp', `${kind}.zip`);
  if (kind === 'bundle') {
    await loadEnv();
    await build();
    await createBundle(archivePath);
  } else {
    const plan = await detectBuildPlan(cwd);
    detected = {
      preset: plan.preset,
      nodeVersion: plan.nodeVersion,
      installCommand: plan.installCommand,
      buildCommand: plan.buildCommand,
      startCommand: plan.startCommand,
      outputDirectory: plan.outputDirectory,
    };
    printDetectedPlan({ ...detected, ...definedOnly(overrides) }, plan.notes);
    const { fileCount, sizeBytes, usedGit } = await packSource(cwd, archivePath);
    console.log(
      `Packed ${fileCount} files (${formatMb(sizeBytes)})` +
        (usedGit ? ' from git' : '; not a git repository, so only default exclusions applied')
    );
  }

  let target = resolveTargetFromOptions(options, project);
  let token = await resolveToken(host);
  if (!token || !target) {
    // The browser flow hands back a token and, when the target is not known
    // yet, the environment picked there — one visit covers a fresh machine
    // and a fresh project. A target from flags or the project file is final,
    // so the page then only authorizes.
    const auth = await authenticateCli(host, {
      pick: target ? undefined : 'deploy',
      purpose: 'deploy',
      appId: project.appId,
    });
    token = auth.token;
    await rememberToken(host, auth.token, auth.expiresAt);
    if (auth.target) {
      target = { environmentId: auth.target.environmentId };
      await rememberTarget(auth.target);
    }
  }
  if (!target) {
    throw new Error(
      'No deploy target selected. Run again and pick an environment in the browser, or pass --app and --env.'
    );
  }

  const session: Session = { host, token };
  // Cached token expired or was revoked: authorize once more. The deploy
  // itself is never repeated — an upload that failed authentication did not
  // start anything, and a build already running is simply followed again.
  const signInAgain = async () => {
    await clearCachedToken(host);
    console.log('Your saved login has expired; please sign in again.');
    const auth = await authenticateCli(host, {
      pick: target ? undefined : 'deploy',
      purpose: 'deploy',
      appId: project.appId,
    });
    await rememberToken(host, auth.token, auth.expiresAt);
    if (auth.target) {
      target = { environmentId: auth.target.environmentId };
      await rememberTarget(auth.target);
    }
    session.token = auth.token;
  };

  try {
    let started: StartedDeploy;
    try {
      started = await runDeploy({
        session,
        target,
        kind,
        archivePath,
        overrides,
        detected,
        project,
      });
    } catch (error) {
      if (!isUnauthorized(error)) {
        throw error;
      }
      await signInAgain();
      started = await runDeploy({
        session,
        target,
        kind,
        archivePath,
        overrides,
        detected,
        project,
      });
    }
    if (started.buildId) {
      await followDeploy(session, signInAgain, started.environmentId, started.buildId);
    }
  } finally {
    await fs.rm(archivePath, { force: true });
  }
}

function isUnauthorized(error: unknown): boolean {
  return error instanceof StudioApiError && error.status === 401;
}

interface StartedDeploy {
  environmentId: string;
  // Null from a Studio too old to have the status route.
  buildId: string | null;
}

async function runDeploy({
  session,
  target,
  kind,
  archivePath,
  overrides,
  detected,
  project,
}: {
  session: Session;
  target: CliTarget;
  kind: UploadKind;
  archivePath: string;
  overrides: BuildPlanInput;
  detected?: BuildPlanInput;
  project: Awaited<ReturnType<typeof readProject>>;
}): Promise<StartedDeploy> {
  const { host, token } = session;
  const upload = await studioRequest<{
    uploadUrl: string;
    bundleName: string;
    appAlias: string;
    envAlias: string;
    environmentId: string;
  }>(host, '/api/upload-bundle', { method: 'POST', token, body: { ...target, kind } });

  await waitForEnvironmentReady(host, token, upload.environmentId);

  console.log(`Uploading to ${upload.appAlias}/${upload.envAlias}...`);
  const fileBuffer = await fs.readFile(archivePath);
  const uploadResponse = await fetch(upload.uploadUrl, {
    method: 'PUT',
    body: new Uint8Array(fileBuffer),
    headers: { 'Content-Type': 'application/zip' },
  });
  if (!uploadResponse.ok) {
    throw new Error(`Failed to upload: ${uploadResponse.statusText}`);
  }

  const result = await studioRequest<{
    deploymentUrl: string;
    appAlias: string;
    envAlias: string;
    environmentId: string;
    buildId: string | null;
    plan?: BuildPlanInput | null;
  }>(host, '/api/deploy', {
    method: 'POST',
    token,
    body: {
      environmentId: upload.environmentId,
      bundleName: upload.bundleName,
      kind,
      plan: definedOnly(overrides),
      detected: detected ? definedOnly(detected) : undefined,
    },
  });

  // Whatever the target was resolved from, the next run can skip the picker.
  if (!project.deploy || project.deploy.environmentId !== result.environmentId) {
    await rememberTarget({
      environmentId: result.environmentId,
      appAlias: result.appAlias,
      envAlias: result.envAlias,
    });
  }

  if (result.plan) {
    reportResolvedPlan(result.plan, detected);
  }

  console.log(`Deployment started: ${result.deploymentUrl}`);
  return { environmentId: result.environmentId, buildId: result.buildId };
}

// An environment created moments ago in the browser is still provisioning
// its database and telemetry; deploys are refused until it is ready.
async function waitForEnvironmentReady(host: string, token: string, environmentId: string) {
  const deadline = Date.now() + PROVISION_TIMEOUT_MS;
  let announced = false;
  while (Date.now() < deadline) {
    let status: string;
    try {
      ({ status } = await studioRequest<{ status: string }>(host, '/api/environment/status', {
        token,
        query: { environmentId },
      }));
    } catch (error) {
      if (error instanceof StudioApiError && error.status === 404) {
        // Older Studio without the route: let /api/deploy decide.
        return;
      }
      throw error;
    }
    if (status === 'ready') {
      return;
    }
    if (status === 'failed') {
      throw new Error('The environment failed to provision; check it in the dashboard.');
    }
    if (!announced) {
      console.log('Waiting for the environment to finish provisioning...');
      announced = true;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error('Timed out waiting for the environment to be ready.');
}

// Prints phase transitions and streams build log lines until the deploy
// settles. Exit code reflects the outcome so CI and agents can act on it.
async function followDeploy(
  session: Session,
  signInAgain: () => Promise<void>,
  environmentId: string,
  buildId: string
) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let lastStatus = '';
  let lastMessage = '';
  let logOffset = 0;
  let signedInAgain = false;

  while (Date.now() < deadline) {
    let status: DeployStatus;
    try {
      status = await studioRequest<DeployStatus>(session.host, '/api/deploy/status', {
        token: session.token,
        query: { environmentId, buildId, logOffset },
      });
    } catch (error) {
      // A token can expire while a long rollout is being watched; the
      // build keeps going on the server, so only the watching resumes.
      if (!isUnauthorized(error) || signedInAgain) {
        throw error;
      }
      signedInAgain = true;
      await signInAgain();
      continue;
    }

    for (const line of status.logs) {
      process.stdout.write(`  │ ${line.replace(/\n$/, '')}\n`);
    }
    // A poll that could not read CloudWatch reports zero lines; keeping the
    // offset avoids replaying the whole log on the next poll.
    logOffset = Math.max(logOffset, status.logCount);

    if (status.status !== lastStatus) {
      lastStatus = status.status;
      const message = describeStatus(status);
      // Two statuses can share a message (deploy-pending and deploying).
      if (message && message !== lastMessage) {
        lastMessage = message;
        console.log(message);
      }
    }

    if (status.status === 'deploy-completed') {
      if (status.siteUrl) {
        console.log(`Live at ${status.siteUrl}`);
      }
      return;
    }
    if (status.status === 'build-failed' || status.status === 'deploy-failed') {
      for (const error of status.errors) {
        console.error(`  ${error}`);
      }
      if (status.containerLogs && status.containerLogs.length > 0) {
        console.error('Container output:');
        for (const line of status.containerLogs) {
          console.error(`  │ ${line.replace(/\n$/, '')}`);
        }
      }
      process.exitCode = 1;
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  console.error('Timed out waiting for the deployment; check the dashboard for its status.');
  process.exitCode = 1;
}

function describeStatus(status: DeployStatus): string | null {
  switch (status.status) {
    case 'build-pending':
      return 'Building image...';
    case 'deploy-pending':
    case 'deploying':
      return 'Image built. Deploying containers...';
    case 'rolling-out':
      return 'Rolling out new containers...';
    case 'deploy-completed':
      return 'Deployed successfully.';
    case 'build-failed':
      return 'Build failed.';
    case 'deploy-failed':
      return 'Deployment failed.';
    default:
      return null;
  }
}

function resolveTargetFromOptions(
  options: DeployOptions,
  project: Awaited<ReturnType<typeof readProject>>
): CliTarget | null {
  if (options.app && options.env) {
    return { appAlias: options.app, envAlias: options.env };
  }
  if (options.env && project.deploy?.appAlias) {
    return { appAlias: project.deploy.appAlias, envAlias: options.env };
  }
  if (options.env && project.appId) {
    return { appId: project.appId, envAlias: options.env };
  }
  if (options.app || options.env) {
    throw new Error('Pass both --app and --env, or neither to pick the target in the browser.');
  }
  if (project.deploy?.environmentId) {
    return { environmentId: project.deploy.environmentId };
  }
  return null;
}

async function resolveToken(host: string): Promise<string | null> {
  if (process.env.MODELENCE_TOKEN) {
    return process.env.MODELENCE_TOKEN;
  }
  return await readCachedToken(host);
}

async function rememberToken(host: string, token: string, expiresAt?: string) {
  if (!expiresAt) {
    // Older Studio: the token lasts an hour, not worth caching.
    return;
  }
  try {
    await writeCachedToken(host, token, expiresAt);
  } catch (error) {
    console.warn('Could not save the login for next time:', error);
  }
}

async function rememberTarget(target: CliAuthTarget | DeployTarget) {
  const deploy: DeployTarget = {
    environmentId: target.environmentId,
    appAlias: target.appAlias,
    envAlias: target.envAlias,
  };
  try {
    await updateProject({ deploy, ...('appId' in target ? { appId: target.appId } : {}) });
  } catch (error) {
    console.warn('Could not record the deploy target in .modelence/project.json:', error);
  }
}

// The Studio host: flag → environment → the project's .modelence.env → default.
// Read directly rather than through loadEnv(), which requires a
// modelence.config.ts that plain Node.js projects don't have.
async function resolveHost(flag: string | undefined, cwd: string): Promise<string> {
  if (flag) {
    return flag.replace(/\/$/, '');
  }
  if (process.env.MODELENCE_SERVICE_ENDPOINT) {
    return process.env.MODELENCE_SERVICE_ENDPOINT.replace(/\/$/, '');
  }
  try {
    const env = parseDotenv(await fs.readFile(join(cwd, '.modelence.env'), 'utf8'));
    if (env.MODELENCE_SERVICE_ENDPOINT) {
      return env.MODELENCE_SERVICE_ENDPOINT.replace(/\/$/, '');
    }
  } catch {
    // No .modelence.env — plain Node.js projects usually have none.
  }
  return DEFAULT_HOST;
}

function planOverrides(options: DeployOptions): BuildPlanInput {
  return {
    preset: options.preset,
    nodeVersion: options.nodeVersion,
    rootDirectory: options.rootDir,
    installCommand: options.installCommand,
    buildCommand: options.buildCommand,
    startCommand: options.startCommand,
    outputDirectory: options.outputDir,
  };
}

function definedOnly<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined)
  ) as Partial<T>;
}

function printDetectedPlan(plan: BuildPlanInput, notes: string[]) {
  console.log('Build plan:');
  console.log(`  preset:  ${plan.preset ?? 'node'}`);
  console.log(`  node:    ${plan.nodeVersion ?? 'default (22)'}`);
  if (plan.rootDirectory) {
    console.log(`  root:    ${plan.rootDirectory}`);
  }
  console.log(`  install: ${plan.installCommand ?? 'default'}`);
  console.log(`  build:   ${plan.buildCommand || '(none)'}`);
  if (plan.preset === 'static') {
    console.log(`  serve:   ${plan.outputDirectory ?? 'dist'}/ (static site)`);
  } else {
    console.log(`  start:   ${plan.startCommand ?? 'npm start'}`);
  }
  for (const note of notes) {
    console.log(`  note: ${note}`);
  }
}

// Stored environment settings can override what was detected here; say so,
// since the difference is otherwise only visible in the dashboard.
function reportResolvedPlan(used: BuildPlanInput, detected?: BuildPlanInput) {
  if (!detected) {
    return;
  }
  const differences: string[] = [];
  if (used.preset && detected.preset && used.preset !== detected.preset) {
    differences.push(`preset ${used.preset} (detected ${detected.preset})`);
  }
  for (const field of ['installCommand', 'buildCommand', 'startCommand'] as const) {
    const detectedValue = detected[field];
    if (detectedValue !== undefined && used[field] !== undefined && used[field] !== detectedValue) {
      differences.push(
        `${field.replace('Command', '')} "${used[field]}" (detected "${detectedValue}")`
      );
    }
  }
  if (differences.length > 0) {
    console.log("Using the environment's Build & Deploy settings: " + differences.join(', '));
    console.log('Edit them in the dashboard, or pass --preset/--*-command to change them.');
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
