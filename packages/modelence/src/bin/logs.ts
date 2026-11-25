import {
  openEnvironment,
  type EnvironmentOptions,
  type EnvironmentSession,
} from './environmentSession';
import { parseCount, printLine, printNote } from './output';
import { StudioApiError } from './studioApi';

/*
  `modelence logs`: the recent output of an environment's containers, crashed
  ones included. --json prints one object per line, so it can be followed too.
*/

export interface LogsOptions extends EnvironmentOptions {
  service?: string;
  lines?: string;
  since?: string;
  follow?: boolean;
  json?: boolean;
}

export interface LogLine {
  timestamp: string;
  service: string;
  containerId: string;
  message: string;
}

// Studio shares CloudWatch's read limit between everyone, so not faster.
const FOLLOW_INTERVAL_MS = 5000;
const FOLLOW_LINES = 1000;
/*
  Lines reach the log a little late and out of order between containers, so
  each poll reads this far back again and skips what it already printed.
*/
const FOLLOW_OVERLAP_MS = 15 * 1000;

const DURATION_MS: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };

// "10m", "2h", or a time.
export function parseSince(value: string, now: Date): string {
  const duration = /^(\d+)([smhd])$/.exec(value);
  if (duration) {
    return new Date(now.getTime() - Number(duration[1]) * DURATION_MS[duration[2]]).toISOString();
  }
  const time = new Date(value);
  if (Number.isNaN(time.getTime())) {
    throw new Error(`--since takes a duration (10m, 2h, 1d) or an ISO time, not "${value}".`);
  }
  return time.toISOString();
}

export function formatLogLine({ timestamp, service, containerId, message }: LogLine): string {
  return `${timestamp} ${service}/${containerId} ${message.replace(/\r?\n$/, '')}`;
}

// The lines of `batch` beyond those already counted in `printed`.
export function selectNewLines(
  batch: LogLine[],
  printed: ReadonlyMap<string, number>
): { lines: LogLine[]; counts: Map<string, number> } {
  const counts = new Map<string, number>();
  const lines = batch.filter((line) => {
    const key = formatLogLine(line);
    const count = (counts.get(key) ?? 0) + 1;
    counts.set(key, count);
    return count > (printed.get(key) ?? 0);
  });
  return { lines, counts };
}

export async function logs(options: LogsOptions): Promise<void> {
  const limit = parseCount(options.lines, '--lines');
  const since = options.since ? parseSince(options.since, new Date()) : undefined;
  const session = await openEnvironment(options);
  const read = (query: LogQuery) => fetchLines(session, { service: options.service, ...query });
  const print = (line: LogLine) =>
    printLine(options.json ? JSON.stringify(line) : formatLogLine(line));

  const first = await read({ limit, since });
  first.lines.forEach(print);
  noteUnread(first.unreadServices);
  if (options.follow) {
    await follow({ read, print, first: first.lines, since });
  } else if (first.lines.length === 0) {
    printNote('No log lines.');
  }
}

interface LogQuery {
  service?: string;
  limit?: number;
  since?: string;
}

interface LogPage {
  lines: LogLine[];
  unreadServices: string[];
}

async function fetchLines(
  session: EnvironmentSession,
  { service, limit, since }: LogQuery
): Promise<LogPage> {
  return await session.get<LogPage>('/api/cli/logs', {
    ...(service ? { service } : {}),
    ...(limit ? { limit } : {}),
    ...(since ? { since } : {}),
  });
}

function noteUnread(services: string[]): void {
  if (services.length > 0) {
    printNote(`Could not read the logs of ${services.join(', ')} just now.`);
  }
}

/*
  Where the next poll reads from. Only times of lines already read count,
  never this computer's clock, which can be ahead of Studio's. Never before
  what was shown first: lines --lines or --since left out stay out.
*/
export function nextSince(
  newest: string | undefined,
  oldest: string | undefined
): string | undefined {
  if (!newest) {
    return oldest;
  }
  const overlapped = new Date(new Date(newest).getTime() - FOLLOW_OVERLAP_MS).toISOString();
  return oldest && oldest > overlapped ? oldest : overlapped;
}

// Until interrupted.
async function follow({
  read,
  print,
  first,
  since,
}: {
  read: (query: LogQuery) => Promise<LogPage>;
  print: (line: LogLine) => void;
  first: LogLine[];
  since: string | undefined;
}): Promise<never> {
  const oldest = first[0]?.timestamp ?? since;
  let printed = selectNewLines(first, new Map()).counts;
  let newest = first.at(-1)?.timestamp;
  let warned = false;
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, FOLLOW_INTERVAL_MS));
    try {
      const page = await read({ limit: FOLLOW_LINES, since: nextSince(newest, oldest) });
      const { lines, counts } = selectNewLines(page.lines, printed);
      lines.forEach(print);
      // A service that wasn't read this time still has its lines printed.
      printed = page.unreadServices.length > 0 ? mergeCounts(printed, counts) : counts;
      newest = page.lines.at(-1)?.timestamp ?? newest;
      warned = page.unreadServices.length > 0 && (warned || warnUnread(page.unreadServices));
    } catch (error) {
      if (!isTransient(error)) {
        throw error;
      }
      // Said once rather than on every poll.
      if (!warned) {
        warned = true;
        printNote(`Could not read the logs, retrying: ${String(error)}`);
      }
    }
  }
}

function warnUnread(services: string[]): true {
  noteUnread(services);
  return true;
}

function mergeCounts(
  earlier: ReadonlyMap<string, number>,
  later: ReadonlyMap<string, number>
): Map<string, number> {
  return new Map([...earlier, ...later]);
}

function isTransient(error: unknown): boolean {
  if (error instanceof StudioApiError) {
    return error.status === 429 || error.status >= 500;
  }
  // What fetch throws when there is no network.
  return error instanceof TypeError;
}
