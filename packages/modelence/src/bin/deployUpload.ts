import { openAsBlob } from 'fs';
import type { AppSpec } from './appSpec';
import type { CliTarget } from './deployTarget';
import type { Session } from './deploySession';
import type { ResolvedSpec } from './deploySpec';
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
  spec,
}: {
  session: Session;
  target: CliTarget;
  kind: UploadKind;
  archivePath: string;
  // The project's modelence.config.json; required by Studio for source uploads.
  spec?: AppSpec;
}): Promise<StartedDeploy> {
  const { host, token } = session;
  const requestUpload = () =>
    studioRequest<{
      uploadUrl: string;
      bundleName: string;
      appAlias: string;
      envAlias: string;
      environmentId: string;
    }>(host, '/api/upload-bundle', { method: 'POST', token, body: { ...target, kind } });

  // The first call also resolves an alias target to its environment, so it
  // has to happen before the wait.
  let upload = await requestUpload();
  /*
    Studio versions before source deploys answer without the environment
    id, ignore `kind` and `spec`, and would build the upload as a prebuilt
    Modelence bundle. Stopping here beats deploying something else.
  */
  if (!upload.environmentId) {
    throw new Error(
      'Modelence Cloud is too old for this CLI version (no environment id from /api/upload-bundle). ' +
        'Try again later, or deploy with modelence@0.25.'
    );
  }

  // Provisioning can take minutes, which is long enough for the signed URL
  // to expire before the upload starts, so it is signed again afterwards.
  if (await waitForEnvironmentReady(host, token, upload.environmentId)) {
    upload = await requestUpload();
  }

  console.log(`Uploading to ${upload.appAlias}/${upload.envAlias}...`);
  const archive = await openAsBlob(archivePath, { type: 'application/zip' });
  const uploadResponse = await fetch(upload.uploadUrl, {
    method: 'PUT',
    body: archive,
    headers: { 'Content-Type': 'application/zip' },
  });
  if (!uploadResponse.ok) {
    throw new Error(`Failed to upload: ${await describeUploadFailure(uploadResponse)}`);
  }

  const result = await studioRequest<{
    deploymentUrl: string;
    appAlias: string;
    envAlias: string;
    environmentId: string;
    buildId: string | null;
    // The spec Studio resolved the file against its runtime defaults to.
    spec?: ResolvedSpec | null;
  }>(host, '/api/deploy', {
    method: 'POST',
    token,
    body: {
      environmentId: upload.environmentId,
      bundleName: upload.bundleName,
      kind,
      spec,
    },
  });

  console.log(`Deployment started: ${result.deploymentUrl}`);
  return { environmentId: result.environmentId, buildId: result.buildId };
}

// S3 reports an expired or malformed signature as a 403 with an XML body;
// the status text alone reads like a permissions problem.
async function describeUploadFailure(response: Response): Promise<string> {
  const detail = await response.text().catch(() => '');
  const code = detail.match(/<Code>([^<]+)<\/Code>/)?.[1];
  const message = detail.match(/<Message>([^<]+)<\/Message>/)?.[1];
  const status = response.statusText || `HTTP ${response.status}`;
  if (!code) {
    return status;
  }
  return `${status} (${code}${message ? `: ${message}` : ''})`;
}
