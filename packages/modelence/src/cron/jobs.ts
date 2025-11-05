// import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';

import { time } from '../time';
import { CronJob, CronJobInputParams } from './types';
import { startTransaction, captureError } from '@/telemetry';
import { Module } from '../app/module';
import { schema } from '../data/types';
import { Store } from '../data/store';
import { acquireLock, verifyLockOwnership, startLockHeartbeat } from '../lock/helpers';

const DEFAULT_TIMEOUT = time.minutes(1);

/**
 * Interval at which we retry acquiring the cron lock if we don't have it
 */
const LOCK_RETRY_INTERVAL = time.seconds(30);

const cronJobs: Record<string, CronJob> = {};
let cronJobsInterval: NodeJS.Timeout | null = null;
let cronJobsStarted = false;

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
  { description = '', interval, timeout = DEFAULT_TIMEOUT, handler }: CronJobInputParams
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

/**
 * Initializes the cron job scheduler.
 * Attempts to acquire the cron lock and start cron jobs.
 * If the lock is held by another instance, periodically retries.
 */
export async function startCronJobs() {
  if (cronJobsStarted) {
    throw new Error('Cron jobs already started');
  }

  const aliasList = Object.keys(cronJobs);
  if (aliasList.length === 0) {
    return;
  }

  cronJobsStarted = true;

  await tryAcquireLockAndStartJobs();

  setInterval(async () => {
    if (!cronJobsInterval) {
      // We don't have the lock, try to acquire it
      await tryAcquireLockAndStartJobs();
    }
  }, LOCK_RETRY_INTERVAL);
}

/**
 * Attempts to acquire the cron lock and start the cron job scheduler.
 * If the lock is acquired, initializes job schedules and starts the tick interval.
 */
async function tryAcquireLockAndStartJobs() {
  const aliasList = Object.keys(cronJobs);
  if (aliasList.length === 0) {
    return;
  }

  // Try to acquire the cron lock
  const lockAcquired = await acquireLock('cron');

  if (!lockAcquired) {
    // There's another active instance holding the cron lock
    if (!cronJobsInterval) {
      console.log('Cron jobs are locked by another instance, will retry later');
    }
    return;
  }

  console.log('Acquired cron lock, starting cron jobs');

  // Load job schedules from database
  const cronJobRecords = await cronJobsCollection.fetch({
    alias: { $in: aliasList },
  });
  const nowTimestamp = Date.now();
  cronJobRecords.forEach((record) => {
    const job = cronJobs[record.alias];
    if (!job) {
      return;
    }
    job.state.scheduledRunTs = record.lastStartDate
      ? record.lastStartDate.getTime() + job.params.interval
      : nowTimestamp;
  });
  Object.values(cronJobs).forEach((job) => {
    if (!job.state.scheduledRunTs) {
      job.state.scheduledRunTs = nowTimestamp;
    }
  });

  // Start the cron job tick interval and heartbeat
  cronJobsInterval = setInterval(tickCronJobs, time.seconds(1));
  startLockHeartbeat('cron');
}

/**
 * Verifies that this container owns the cron lock
 */
async function verifyCronLock(): Promise<boolean> {
  return verifyLockOwnership('cron');
}

/**
 * Checks if this container still owns the cron lock.
 * If the lock was lost, stops the cron job execution.
 */
async function verifyLockOwnershipAndStop() {
  const ownsLock = await verifyCronLock();

  if (!ownsLock && cronJobsInterval) {
    console.log('Lost cron lock, stopping job execution');
    clearInterval(cronJobsInterval);
    cronJobsInterval = null;
  }
}

async function tickCronJobs() {
  await verifyLockOwnershipAndStop();

  const now = Date.now();
  const jobs = Object.values(cronJobs);

  for (const job of jobs) {
    const { params, state } = job;
    if (state.isRunning) {
      if (state.startTs && state.startTs + params.timeout < now) {
        // TODO: log cron trace timeout error
        state.isRunning = false;
      }
      continue;
    }

    // TODO: limit the number of jobs running concurrently

    if (state.scheduledRunTs && state.scheduledRunTs <= now) {
      const ownsLock = await verifyCronLock();
      if (ownsLock) {
        await startCronJob(job);
      }
    }
  }
}

async function startCronJob(job: CronJob) {
  const { alias, params, handler, state } = job;
  state.isRunning = true;
  state.startTs = Date.now();

  await cronJobsCollection.updateOne(
    { alias },
    {
      $set: {
        lastStartDate: new Date(state.startTs),
      },
    }
  );

  const transaction = startTransaction('cron', `cron:${alias}`);
  // TODO: enforce job timeout
  try {
    await handler();
    handleCronJobCompletion(state, params);
    transaction.end('success');
  } catch (err) {
    handleCronJobCompletion(state, params);
    const error = err instanceof Error ? err : new Error(String(err));
    captureError(error);
    transaction.end('error');
    console.error(`Error in cron job '${alias}':`, err);
  }
}

function handleCronJobCompletion(state: CronJob['state'], params: CronJob['params']) {
  state.scheduledRunTs = state.startTs ? state.startTs + params.interval : Date.now();
  state.startTs = undefined;
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
