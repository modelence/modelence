import { promises as fs } from 'fs';
import { join } from 'path';
import { APP_SPEC_FILE_NAME, readAppSpecFile } from './appSpec';
import type { UploadKind } from './deployUpload';

/*
  Which upload `modelence deploy` makes. Two paths exist:

  - `source`: the tree is uploaded and built remotely as modelence.config.json
    describes — the path for any Node.js app.
  - `bundle`: the historical Modelence path — build locally, upload
    .modelence/build.

  `--prebuilt` forces `bundle`. Otherwise a modelence.config.json means `source`.
  Without either, a project that depends on the `modelence` package is a
  framework app that deployed with this command long before the file
  existed, so it keeps the bundle path unchanged; anything else is `source`,
  where the missing file is reported with the setup prompt. Detecting the
  framework by its dependency is a fact about the project, not a guess about
  how to build it.
*/

export type DeployKindReason = 'prebuilt-flag' | 'spec-file' | 'modelence-dependency' | 'default';

export interface DeployKindDecision {
  kind: UploadKind;
  reason: DeployKindReason;
}

export async function resolveDeployKind(
  cwd: string,
  options: { prebuilt?: boolean }
): Promise<DeployKindDecision> {
  if (options.prebuilt) {
    return { kind: 'bundle', reason: 'prebuilt-flag' };
  }
  if ((await readAppSpecFile(cwd)) !== null) {
    return { kind: 'source', reason: 'spec-file' };
  }
  if (await dependsOnModelence(cwd)) {
    return { kind: 'bundle', reason: 'modelence-dependency' };
  }
  return { kind: 'source', reason: 'default' };
}

export function describeDeployKind(decision: DeployKindDecision): string | null {
  if (decision.reason !== 'modelence-dependency') {
    return null;
  }
  return (
    `No ${APP_SPEC_FILE_NAME} found; this is a Modelence app, so it is built locally and uploaded as before. ` +
    `Add a ${APP_SPEC_FILE_NAME} with "runtime": "modelence" to build it on Modelence Cloud instead.`
  );
}

async function dependsOnModelence(cwd: string): Promise<boolean> {
  let content: string;
  try {
    content = await fs.readFile(join(cwd, 'package.json'), 'utf8');
  } catch {
    return false;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    // An unreadable package.json is the app's problem to report, not a
    // reason to pick a deploy path; the source path's checks will surface it.
    return false;
  }
  if (!parsed || typeof parsed !== 'object') {
    return false;
  }
  const manifest = parsed as Record<string, unknown>;
  return ['dependencies', 'devDependencies'].some((field) => {
    const section = manifest[field];
    return Boolean(section && typeof section === 'object' && 'modelence' in section);
  });
}
