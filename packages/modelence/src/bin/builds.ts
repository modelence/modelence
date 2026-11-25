import { openEnvironment, type EnvironmentOptions } from './environmentSession';
import { formatTable, parseCount, printJson, printLine, printNote } from './output';

// `modelence builds`: an environment's deploys, and the log of one of them.

export interface BuildSummary {
  id: string;
  number: number | null;
  status: string;
  isCurrent: boolean;
  source: string | null;
  appVersion: string | null;
  commitSha: string | null;
  createdAt: string;
  finishedAt: string | null;
  errors: string[];
}

interface BuildLog {
  build: BuildSummary;
  lines: string[];
  truncated: boolean;
  containerLogs: string[];
}

export interface BuildsOptions extends EnvironmentOptions {
  limit?: string;
  json?: boolean;
}

export interface BuildLogsOptions extends EnvironmentOptions {
  lines?: string;
  json?: boolean;
}

export function describeBuild(build: BuildSummary): string {
  const name = build.number === null ? build.id : `#${build.number}`;
  const revision = [build.appVersion, build.commitSha?.slice(0, 7)].filter(Boolean).join(' ');
  return `${name} ${build.status}${revision ? ` (${revision})` : ''}, ${build.createdAt}`;
}

export async function listBuilds(options: BuildsOptions): Promise<void> {
  const limit = parseCount(options.limit, '--limit');
  const session = await openEnvironment(options);
  const result = await session.get<{ builds: BuildSummary[]; total: number }>(
    '/api/cli/builds',
    limit ? { limit } : {}
  );
  if (options.json) {
    printJson(result);
    return;
  }
  if (result.builds.length === 0) {
    printNote('No builds in this environment yet.');
    return;
  }
  const rows = result.builds.map((build) => [
    build.number === null ? '-' : `#${build.number}`,
    build.status,
    build.createdAt,
    build.appVersion ?? '-',
    build.commitSha?.slice(0, 7) ?? '-',
    build.isCurrent ? 'running' : '',
  ]);
  formatTable([['BUILD', 'STATUS', 'CREATED', 'VERSION', 'COMMIT', ''], ...rows]).forEach((line) =>
    printLine(line)
  );
}

// The latest build's, without a reference (its number or id).
export async function buildLogs(
  reference: string | undefined,
  options: BuildLogsOptions
): Promise<void> {
  const lines = parseCount(options.lines, '--lines');
  const session = await openEnvironment(options);
  const log = await session.get<BuildLog>('/api/cli/builds/logs', {
    // The number as the list shows it, too.
    ...(reference ? { build: reference.replace(/^#/, '') } : {}),
    ...(lines ? { limit: lines } : {}),
  });
  if (options.json) {
    printJson(log);
    return;
  }
  printNote(describeBuild(log.build));
  if (log.truncated) {
    printNote('Showing the end of the log; --lines shows more.');
  }
  log.lines.forEach((line) => printLine(line.replace(/\n$/, '')));
  log.build.errors.forEach((error) => printLine(`Error: ${error}`));
  if (log.containerLogs.length > 0) {
    printLine('Container output:');
    log.containerLogs.forEach((line) => printLine(line.replace(/\n$/, '')));
  }
}
