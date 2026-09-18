import { openAsBlob } from 'fs';
import { mergeAppSpecs } from './appSpec';
import type { ProjectFile } from './project';
import type { CliTarget } from './deployTarget';
import { rememberTarget, type Session } from './deploySession';
import { reportEnvironmentSettings, type ResolvedSpec, type SpecLayers } from './deploySpec';
import { waitForEnvironmentReady } from './deployStatus';
import { studioRequest } from './studioApi';

export type UploadKind = 'bundle' | 'source';

export interface StartedDeploy {
  environmentId: string;
  // Null from a Studio too old to have the status route.
  buildId: string | null;
}

export async function runDeploy({
  session,
  target,
  kind,
  archivePath,
  layers,
  project,
}: {
  session: Session;
  target: CliTarget;
  kind: UploadKind;
  archivePath: string;
  layers?: SpecLayers;
  project: ProjectFile;
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
  const archive = await openAsBlob(archivePath, { type: 'application/zip' });
  const uploadResponse = await fetch(upload.uploadUrl, {
    method: 'PUT',
    body: archive,
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
    spec?: ResolvedSpec | null;
  }>(host, '/api/deploy', {
    method: 'POST',
    token,
    body: {
      environmentId: upload.environmentId,
      bundleName: upload.bundleName,
      kind,
      spec: layers?.file ?? undefined,
      overrides: layers?.overrides,
      detected: layers?.detected,
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

  if (result.spec && layers) {
    reportEnvironmentSettings(
      result.spec,
      mergeAppSpecs(layers.detected, layers.file, layers.overrides)
    );
  }

  console.log(`Deployment started: ${result.deploymentUrl}`);
  return { environmentId: result.environmentId, buildId: result.buildId };
}
