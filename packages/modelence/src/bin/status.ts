import { describeBuild, type BuildSummary } from './builds';
import { openEnvironment, type EnvironmentOptions } from './environmentSession';
import { printJson, printLine } from './output';

/*
  `modelence status`: what an environment runs and what needs attention.
  `modelence restart`: new containers on the version already deployed.
*/

interface ServiceStatus {
  name: string;
  desiredCount: number;
  runningCount: number;
  lastCrash: { stoppedAt: string | null; exitCode: number | null; reason: string | null } | null;
}

export interface EnvironmentStatus {
  app: { id: string; alias: string };
  environment: { id: string; alias: string; type: string; status: string; errors: string[] };
  isStopped: boolean;
  siteUrl: string | null;
  dashboardUrl: string;
  configUrl: string;
  services: ServiceStatus[];
  currentBuild: BuildSummary | null;
  latestBuild: BuildSummary | null;
  missingEnvVars: string[];
  restartNeeded: boolean;
}

function describeService({ name, desiredCount, runningCount, lastCrash }: ServiceStatus): string {
  const counts = `  ${name}: ${runningCount} of ${desiredCount} running`;
  if (!lastCrash) {
    return counts;
  }
  const details = [
    lastCrash.exitCode === null ? null : `exit code ${lastCrash.exitCode}`,
    lastCrash.reason,
    lastCrash.stoppedAt,
  ].filter(Boolean);
  return `${counts}; last crash: ${details.join(', ')}`;
}

export function formatStatus(status: EnvironmentStatus): string[] {
  const { app, environment, currentBuild, latestBuild } = status;
  const state = status.isStopped ? 'stopped' : environment.status;
  return [
    `${app.alias} / ${environment.alias} (${environment.type}, ${state})`,
    ...environment.errors.map((error) => `Error: ${error}`),
    ...(status.siteUrl ? [`URL: ${status.siteUrl}`] : []),
    `Dashboard: ${status.dashboardUrl}`,
    ...(status.services.length > 0 ? ['Services:', ...status.services.map(describeService)] : []),
    `Running build: ${currentBuild ? describeBuild(currentBuild) : 'none'}`,
    ...(latestBuild && latestBuild.id !== currentBuild?.id
      ? [
          `Latest build: ${describeBuild(latestBuild)}`,
          ...latestBuild.errors.map((error) => `  ${error}`),
        ]
      : []),
    ...(status.missingEnvVars.length > 0
      ? [`Variables without a value: ${status.missingEnvVars.join(', ')}`]
      : []),
    ...(status.restartNeeded
      ? ['Restart needed: variables changed since the containers started.']
      : []),
  ];
}

export async function status(options: EnvironmentOptions & { json?: boolean }): Promise<void> {
  const session = await openEnvironment(options);
  const result = await session.get<EnvironmentStatus>('/api/cli/status');
  if (options.json) {
    printJson(result);
    return;
  }
  formatStatus(result).forEach((line) => printLine(line));
}

export async function restart(options: EnvironmentOptions): Promise<void> {
  const session = await openEnvironment(options);
  await session.post('/api/cli/restart');
  printLine('Restarting. New containers replace the running ones once they are healthy.');
}
