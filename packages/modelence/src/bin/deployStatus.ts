import { StudioApiError, studioRequest } from './studioApi';
import { isUnauthorized, type Session } from './deploySession';

const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 30 * 60 * 1000;
const PROVISION_TIMEOUT_MS = 10 * 60 * 1000;

interface DeployStatus {
  status: string;
  errors: string[];
  rolloutProgress: { updatedCount: number; totalCount: number } | null;
  logs: string[];
  // Where the next poll resumes the build log; null until the log exists.
  logCursor: string | null;
  siteUrl: string | null;
  // Last output of the containers a failed rollout tried to start.
  containerLogs?: string[];
}

// An environment created moments ago in the browser is still provisioning
// its database and telemetry; deploys are refused until it is ready.
// Returns whether it actually had to wait, so the caller can refresh an
// upload URL that may have been signed before a long provision.
export async function waitForEnvironmentReady(
  host: string,
  token: string,
  environmentId: string
): Promise<boolean> {
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
        return false;
      }
      throw error;
    }
    if (status === 'ready') {
      return announced;
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
export async function followDeploy(
  session: Session,
  signInAgain: () => Promise<void>,
  environmentId: string,
  buildId: string
) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let lastStatus = '';
  let lastMessage = '';
  let logCursor: string | null = null;
  let signedInAgain = false;

  while (Date.now() < deadline) {
    let status: DeployStatus;
    try {
      status = await studioRequest<DeployStatus>(session.host, '/api/deploy/status', {
        token: session.token,
        query: { environmentId, buildId, ...(logCursor ? { logCursor } : {}) },
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
    // A poll that could not read CloudWatch hands back the cursor it got, or
    // none; keeping ours avoids replaying the whole log on the next poll.
    logCursor = status.logCursor ?? logCursor;

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
