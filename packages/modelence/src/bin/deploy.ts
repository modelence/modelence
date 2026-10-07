import { createWriteStream, promises as fs } from 'fs';
import { join } from 'path';
import archiver from 'archiver';
import { authenticateCli } from './auth';
import { clearCachedToken } from './authCache';
import { loadEnv, getProjectPath } from './config';
import { otherTargetHosts, projectForHost, readProject } from './project';
import { packSource } from './source';
import { build } from './build';
import { prepareSpec } from './deploySpec';
import { describeDeployKind, resolveDeployKind } from './deployKind';
import { readAppSpecFile, type AppSpec } from './appSpec';
import { describeOtherHosts, resolveTargetFromOptions } from './deployTarget';
import { isCI } from './terminal';
import {
  assertEnvTokenHost,
  resolveHost,
  resolveToken,
  rememberToken,
  rememberTarget,
  isUnauthorized,
  type Session,
} from './deploySession';
import { runDeploy, type StartedDeploy, type UploadKind } from './deployUpload';
import { followDeploy } from './deployStatus';

/*
  `modelence deploy`: ship the current directory to a Modelence Cloud
  environment.

  Default path — any Node.js app: the source tree is uploaded and built
  remotely as the project's modelence.config.json describes. Studio resolves that
  file against the defaults of its runtime and nothing else; the CLI neither
  inspects nor amends anything. `--prebuilt` keeps the historical
  Modelence path: build locally, upload .modelence/build — and so does a
  Modelence framework app that has no modelence.config.json, so projects that
  deployed before the file existed keep deploying unchanged (deployKind.ts).

  Target: picked in the browser on every deploy, since a project can have
  several. The target named by -a/-e, or else the one recorded in
  project.json, is only preselected there; that is how an agent that knows
  the target passes it. The picked target is recorded for next time. The
  picker also asks for the variables modelence.config.json requires that
  the target has no value for.

  CI is the one exception: the browser is never opened, the target comes
  from the flags or project.json and the token from MODELENCE_TOKEN, and a
  missing one fails at once instead of waiting for an approval nobody will
  give. Agents run without a TTY too, but they go through the browser like
  anyone else. Since nobody picked anything, Studio refuses a CI deploy
  while a required declared variable has no value (--skip-env-check
  deploys anyway).
*/

export interface DeployOptions {
  app?: string;
  env?: string;
  host?: string;
  prebuilt?: boolean;
  skipEnvCheck?: boolean;
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
  // Targets saved for another Studio don't apply here, but say so: a picker
  // or a "pass --app and --env" out of the blue would be a puzzle.
  const otherHosts = project.deploy ? [] : otherTargetHosts(savedProject, host);
  const ci = isCI();
  // In CI the deploy target; anywhere else what the picker preselects.
  const namedTarget = resolveTargetFromOptions(options, project, otherHosts);
  let token = ci ? await resolveToken(host) : null;
  if (ci && (!token || !namedTarget)) {
    throw new Error(nonInteractiveMessage(Boolean(token), Boolean(namedTarget), otherHosts));
  }
  if (!ci && !namedTarget && otherHosts.length > 0) {
    console.log(
      `Note: ${describeOtherHosts(otherHosts)} Pick a target for ${host} in the browser, or pass --host to deploy there.`
    );
  }

  // Local work first, so nothing is uploaded — and nobody is asked to sign
  // in — when it fails; a missing modelence.config.json stops right here.
  // A --prebuilt deploy still sends the file when there is one, for its
  // variable declarations.
  let spec: AppSpec | undefined;
  const archivePath = join(cwd, '.modelence', 'tmp', `${kind}.zip`);
  if (kind === 'bundle') {
    spec = (await readAppSpecFile(cwd)) ?? undefined;
    await loadEnv();
    await build();
    await createBundle(archivePath);
  } else {
    spec = await prepareSpec(cwd);
    reportPackedSource(await packSource(cwd, archivePath));
  }

  try {
    let target = namedTarget;
    if (!ci) {
      // The browser hands back a token and the environment picked there,
      // where the named target is preselected; one visit covers a fresh
      // machine and a fresh project.
      const auth = await authenticateCli(host, {
        pick: 'deploy',
        purpose: 'deploy',
        appId: project.appId,
        hint: namedTarget ?? undefined,
        env: spec?.env,
      });
      token = auth.token;
      await rememberToken(host, auth.token, auth.expiresAt);
      if (!auth.target) {
        throw new Error(
          'No deploy target selected. Run again and pick an environment in the browser.'
        );
      }
      target = { environmentId: auth.target.environmentId };
      await rememberTarget(auth.target, host);
    }
    if (!token || !target) {
      // Unreachable: CI checked both above, and the browser returns both.
      throw new Error('No token or deploy target to deploy with.');
    }
    const deployTarget = target;

    const session: Session = { host, token };
    // Cached token expired or was revoked: authorize once more. The deploy
    // itself is never repeated — an upload that failed authentication did not
    // start anything, and a build already running is simply followed again.
    const signInAgain = async () => {
      await clearCachedToken(host);
      if (ci) {
        throw new Error(
          'Modelence Cloud rejected the token (expired or revoked), and CI deploys never sign in again in the browser. ' +
            'Set a fresh MODELENCE_TOKEN. A deployment that already started keeps running; check the dashboard.'
        );
      }
      // The target is already picked, so the page only authorizes.
      console.log('Your login has expired; please sign in again.');
      const auth = await authenticateCli(host, { purpose: 'deploy', appId: project.appId });
      await rememberToken(host, auth.token, auth.expiresAt);
      session.token = auth.token;
    };

    // A deploy picked in the browser had its variables asked for there.
    const checkEnv = ci && !options.skipEnvCheck;
    const start = () =>
      runDeploy({ session, target: deployTarget, kind, archivePath, spec, checkEnv });
    let started: StartedDeploy;
    try {
      started = await start();
    } catch (error) {
      if (!isUnauthorized(error)) {
        throw error;
      }
      await signInAgain();
      started = await start();
    }
    if (started.buildId) {
      await followDeploy(session, signInAgain, started.environmentId, started.buildId);
    }
  } finally {
    await fs.rm(archivePath, { force: true });
  }
}

function nonInteractiveMessage(
  hasToken: boolean,
  hasTarget: boolean,
  otherHosts: string[]
): string {
  const needed = [
    hasTarget ? null : 'pass --app and --env',
    hasToken ? null : 'set MODELENCE_TOKEN',
  ].filter(Boolean);
  const hostNote =
    !hasTarget && otherHosts.length > 0
      ? ` Note: ${describeOtherHosts(otherHosts)} Pass --host to deploy there.`
      : '';
  return (
    'CI deploys never open the browser to sign in or pick a target. ' +
    `To deploy from here, ${needed.join(' and ')}.${hostNote}`
  );
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
