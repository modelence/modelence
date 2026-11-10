// import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';

import { time } from '../time';
import { CronJob, CronJobInputParams } from './types';
import { startTransaction, captureError, logError } from '@/telemetry';
import { Module } from '../app/module';
import { schema } from '../data/types';
import { Store } from '../data/store';
import { acquireLock } from '../lock/helpers';
import { getMongodbUri } from '@/db/client';

const cronJobs: Record<string, CronJob> = {};
let cronJobsInterval: NodeJS.Timeout | null = null;
let checkingDueJobs = false;
const CRON_LOCK_CACHE_DURATION = time.seconds(10);

const cronJobsCollection = new Store('_modelenceCronJobs', {
  schema: {
    alias: schema.string(),
    lastStartDate: schema.date().optional(),
  },
  indexes: [{ key: { alias: 1 }, unique: true, background: true }],
});

// TODO: allow changing interval and timeout with cron jobconfigs
export function defineCronJob(
  alias: CronJob['alias'],
  {
    description = '',
    interval,
    timeout = Math.min(Math.max(interval, time.minutes(1)), time.days(1)),
    handler,
  }: CronJobInputParams
) {
  if (cronJobs[alias]) {
    throw new Error(`Duplicate cron job declaration: '${alias}' already exists`);
  }

  if (cronJobsInterval) {
    throw new Error(
      `Unable to add a cron job - cron jobs have already been initialized: [${alias}]`
    );
  }

  if (interval < time.seconds(5)) {
    throw new Error(`Cron job interval should not be less than 5 second [${alias}]`);
  }

  if (timeout > time.days(1)) {
    throw new Error(`Cron job timeout should not be longer than 1 day [${alias}]`);
  }

  cronJobs[alias] = {
    alias,
    params: { description, interval, timeout },
    handler,
    state: {
      isRunning: false,
    },
  };
}

export async function startCronJobs() {
  if (cronJobsInterval) {
    throw new Error('Cron jobs already started');
  }

  const jobs = Object.values(cronJobs);
  if (jobs.length > 0) {
    if (!getMongodbUri()) {
      console.log('MongoDB URI is not configured. Skipping cron jobs.');
      return;
    }

    await refreshCronJobSchedules(jobs);
    cronJobsInterval = setInterval(tickCronJobs, time.seconds(1));
  }
}

async function refreshCronJobSchedules(jobs: CronJob[]) {
  const records = await cronJobsCollection.fetch({
    alias: { $in: jobs.map(({ alias }) => alias) },
  });
  const lastStartDates = new Map(records.map(({ alias, lastStartDate }) => [alias, lastStartDate]));
  const now = Date.now();

  for (const { alias, params, state } of jobs) {
    const lastStartDate = lastStartDates.get(alias);
    if (lastStartDate) {
      const nextRunTs = lastStartDate.getTime() + params.interval;
      state.scheduledRunTs = Math.max(state.scheduledRunTs ?? nextRunTs, nextRunTs);
    } else {
      state.scheduledRunTs ??= now;
    }
  }
}

function isDue({ state }: CronJob, now: number) {
  return !state.isRunning && state.scheduledRunTs !== undefined && state.scheduledRunTs <= now;
}

async function tickCronJobs() {
  const now = Date.now();

  const ownsLock = await acquireLock('cron', {
    successfulLockCacheDuration: CRON_LOCK_CACHE_DURATION,
    failedLockCacheDuration: time.seconds(30),
  });

  if (!ownsLock) {
    return;
  }

  const dueJobs: CronJob[] = [];
  for (const job of Object.values(cronJobs)) {
    const { alias, params, state } = job;
    if (state.isRunning) {
      // Nothing aborts the handler on timeout, so the run keeps its slot until it settles.
      // Restarting it here would stack a new copy on top of a hung one. A handler that never
      // settles blocks its job until the process restarts, so keep reporting it every timeout.
      const { startTs, lastTimeoutReportTs } = state;
      if (startTs && (lastTimeoutReportTs ?? startTs) + params.timeout < now) {
        state.lastTimeoutReportTs = now;
        const timeoutError = new Error(
          `Cron job '${alias}' timed out after ${params.timeout}ms and is still running (${now - startTs}ms elapsed)`
        );
        captureError(timeoutError);
      }
      continue;
    }

    if (isDue(job, now)) {
      dueJobs.push(job);
    }
  }

  if (!dueJobs.length || checkingDueJobs) {
    return;
  }

  checkingDueJobs = true;
  try {
    // Another lock owner may have run these jobs since we last read their schedules.
    await refreshCronJobSchedules(dueJobs);
    const dispatchTs = Date.now();
    if (dispatchTs - now >= CRON_LOCK_CACHE_DURATION) {
      return; // Check again on the next tick if the read outlasted the lock cache.
    }

    // TODO: limit the number of jobs running concurrently
    for (const job of dueJobs) {
      if (isDue(job, dispatchTs)) {
        void runCronJob(job);
      }
    }
  } catch (error) {
    captureError(error instanceof Error ? error : new Error(String(error)));
    logError('Error refreshing cron job schedules:', { error });
  } finally {
    checkingDueJobs = false;
  }
}

async function runCronJob(job: CronJob) {
  const { alias, params, handler, state } = job;
  state.isRunning = true;
  const currentStartTs = Date.now();
  state.startTs = currentStartTs;
  state.lastTimeoutReportTs = undefined;

  const transaction = startTransaction('cron', `cron:${alias}`);
  // TODO: enforce job timeout
  try {
    await cronJobsCollection.upsertOne(
      { alias },
      {
        $set: { lastStartDate: new Date(currentStartTs) },
        $setOnInsert: { alias },
      }
    );
    await handler();
    const result = state.lastTimeoutReportTs ? 'timeout' : 'success';
    handleCronJobCompletion(state, params, currentStartTs);
    transaction.end(result);
  } catch (err) {
    handleCronJobCompletion(state, params, currentStartTs);
    const error = err instanceof Error ? err : new Error(String(err));
    captureError(error);
    transaction.end('error');
    logError('Error in cron job:', { error: err, alias });
  }
}

function handleCronJobCompletion(
  state: CronJob['state'],
  params: CronJob['params'],
  currentStartTs: number
) {
  state.scheduledRunTs = currentStartTs + params.interval;
  state.startTs = undefined;
  state.lastTimeoutReportTs = undefined;
  state.isRunning = false;
}

export function getCronJobsMetadata() {
  return Object.values(cronJobs).map(({ alias, params }) => ({
    alias,
    description: params.description,
    interval: params.interval,
    timeout: params.timeout,
  }));
}

export default new Module('_system.cron', {
  stores: [cronJobsCollection],
});

// const runCronJob = () => {
//   const worker = new Worker(filePath, {
//     workerData: {},
//     execArgv: ['--loader', 'tsx'],
//   });

//   const timeoutId = setTimeout(() => {
//     worker.terminate();
//     console.error(`Cron job '${alias}' timed out after ${timeout}ms`);
//   }, timeout);

//   worker.on('message', (message) => {
//     if (message === 'done') {
//       clearTimeout(timeoutId);
//       worker.terminate();
//     }
//   });

//   worker.on('error', (err) => {
//     clearTimeout(timeoutId);
//     console.error(`Error in cron job '${alias}':`, err);
//   });

//   worker.on('exit', (code) => {
//     console.error(`Cron job '${alias}' exited with code ${code}`);
//     setTimeout(runCronJob, interval);
//   });
// };
