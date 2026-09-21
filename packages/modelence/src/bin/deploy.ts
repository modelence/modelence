import { createWriteStream, promises as fs } from 'fs';
import { join } from 'path';
import archiver from 'archiver';
import { authenticateCli } from './auth';
import { clearCachedToken } from './authCache';
import { loadEnv, getProjectPath } from './config';
import { readProject } from './project';
import { packSource } from './source';
import { build } from './build';
import { prepareSpec } from './deploySpec';
import { describeDeployKind, resolveDeployKind } from './deployKind';
import type { AppSpec } from './appSpec';
import { resolveTargetFromOptions } from './deployTarget';
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
  MODELENCE_TOKEN variable → the cached token → the browser.
*/

export interface DeployOptions {
  app?: string;
  env?: string;
  host?: string;
  prebuilt?: boolean;
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
    const { fileCount, sizeBytes, usedGit, excludedFiles } = await packSource(cwd, archivePath);
    console.log(
      `Packed ${fileCount} files (${formatMb(sizeBytes)})` +
        (usedGit ? ' from git' : '; not a git repository, so only default exclusions applied')
    );
    if (excludedFiles.length > 0) {
      console.log(
        `Excluded ${excludedFiles.length} local or generated files from the upload. Store secrets in the target environment.`
      );
    }
  }

  try {
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

    let started: StartedDeploy;
    try {
      started = await runDeploy({ session, target, kind, archivePath, spec, project });
    } catch (error) {
      if (!isUnauthorized(error)) {
        throw error;
      }
      await signInAgain();
      started = await runDeploy({ session, target, kind, archivePath, spec, project });
    }
    if (started.buildId) {
      await followDeploy(session, signInAgain, started.environmentId, started.buildId);
    }
  } finally {
    await fs.rm(archivePath, { force: true });
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
