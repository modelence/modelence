import { createWriteStream, promises as fs } from 'fs';
import { join } from 'path';
import archiver from 'archiver';
import { authenticateCli } from './auth';
import { clearCachedToken } from './authCache';
import { loadEnv, getProjectPath } from './config';
import { readProject, type ProjectFile } from './project';
import { packSource } from './source';
import { build } from './build';
import { prepareSpec } from './deploySpec';
import { describeDeployKind, resolveDeployKind } from './deployKind';
import type { AppSpec } from './appSpec';
import {
  describeTarget,
  differsFromSavedTarget,
  resolveTargetFromOptions,
  type CliTarget,
} from './deployTarget';
import { confirm, isInteractive } from './terminal';
import {
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

  Target: -a/-e flags → --env with the app recorded in project.json → the
  deploy target recorded in project.json → the browser picker. Auth: the
  MODELENCE_TOKEN variable → the cached token → the browser. Only a target
  picked in the browser is recorded; flags deploy once and change nothing.

  Without someone at the terminal (CI, scripts, agent sandboxes) the browser
  is never opened: a missing token or target fails at once instead of
  waiting for an approval nobody will give.
*/

export interface DeployOptions {
  app?: string;
  env?: string;
  host?: string;
  prebuilt?: boolean;
  yes?: boolean;
}

export async function deploy(options: DeployOptions) {
  const cwd = process.cwd();
  const host = await resolveHost(options.host, cwd);
  const decision = await resolveDeployKind(cwd, options);
  const kind: UploadKind = decision.kind;
  const kindNote = describeDeployKind(decision);
  if (kindNote) {
    console.log(kindNote);
  }
  const project = await readProject(cwd);
  let target = resolveTargetFromOptions(options, project);
  let token = await resolveToken(host);
  if ((!token || !target) && !isInteractive()) {
    throw new Error(nonInteractiveMessage(Boolean(token), Boolean(target)));
  }
  await confirmTarget(target, project, options.yes);

  // Local work first, so nothing is uploaded — and nobody is asked to sign
  // in — when it fails; a missing modelence.config.json stops right here.
  let spec: AppSpec | undefined;
  const archivePath = join(cwd, '.modelence', 'tmp', `${kind}.zip`);
  if (kind === 'bundle') {
    await loadEnv();
    await build();
    await createBundle(archivePath);
  } else {
    spec = await prepareSpec(cwd);
    reportPackedSource(await packSource(cwd, archivePath));
  }

  try {
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
      if (!isInteractive()) {
        throw new Error(
          'Modelence Cloud rejected the token (expired or revoked), and nobody is at the terminal to sign in again. ' +
            'Set a fresh MODELENCE_TOKEN. A deployment that already started keeps running; check the dashboard.'
        );
      }
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

    let started: StartedDeploy;
    try {
      started = await runDeploy({ session, target, kind, archivePath, spec });
    } catch (error) {
      if (!isUnauthorized(error)) {
        throw error;
      }
      await signInAgain();
      started = await runDeploy({ session, target, kind, archivePath, spec });
    }
    if (started.buildId) {
      await followDeploy(session, signInAgain, started.environmentId, started.buildId);
    }
  } finally {
    await fs.rm(archivePath, { force: true });
  }
}

function nonInteractiveMessage(hasToken: boolean, hasTarget: boolean): string {
  const needed = [
    hasTarget ? null : 'pass --app and --env',
    hasToken ? null : 'set MODELENCE_TOKEN',
  ].filter(Boolean);
  return (
    'Nobody is at the terminal to sign in or pick a target in the browser (CI or a non-interactive shell). ' +
    `To deploy from here, ${needed.join(' and ')}.`
  );
}

// Says where the deploy goes before anything is built, and asks first when
// flags point away from the environment this project normally deploys to.
async function confirmTarget(
  target: CliTarget | null,
  project: ProjectFile,
  yes: boolean | undefined
): Promise<void> {
  if (!target) {
    return;
  }
  const label = describeTarget(target, project);
  console.log(`Deploying to ${label}`);
  if (yes || !differsFromSavedTarget(target, project) || !isInteractive()) {
    return;
  }
  const saved = `${project.deploy?.appAlias}/${project.deploy?.envAlias}`;
  if (!(await confirm(`This project normally deploys to ${saved}. Deploy to ${label} instead?`))) {
    throw new Error('Cancelled.');
  }
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
