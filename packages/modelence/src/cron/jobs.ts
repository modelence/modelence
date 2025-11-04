// import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';

import { randomBytes } from 'crypto';
import { time } from '../time';
import { CronJob, CronJobInputParams } from './types';
import { startTransaction, captureError } from '@/telemetry';
import { Module } from '../app/module';
import { schema } from '../data/types';
import { Store } from '../data/store';

const DEFAULT_TIMEOUT = time.minutes(1);


/**
 * Interval at which lock heartbeats are updated in the database
 */
const LOCK_HEARTBEAT_INTERVAL = time.seconds(5);

/**
 * Time after which a lock is considered stale if no heartbeat update was received
 * Should be significantly larger than LOCK_HEARTBEAT_INTERVAL to account for network delays
 */
const LOCK_STALE_THRESHOLD = time.seconds(30);

const cronJobs: Record<string, CronJob> = {};
let cronJobsInterval: NodeJS.Timeout;

/**
 * Unique identifier for this cron instance.
 * Generated once per application instance to track which container owns which locks.
 */
const containerId = randomBytes(32).toString('base64url')

const cronJobsCollection = new Store('_modelenceCronJobs', {
  schema: {
    alias: schema.string(),
    lastStartDate: schema.date().optional(),
    lock: schema.object({
      containerId: schema.string(),
      acquireDate: schema.date(),
      lastHeartbeat: schema.date(),
    }),
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

export async function startCronJobs() {
  if (cronJobsInterval) {
    throw new Error('Cron jobs already started');
  }

  const aliasList = Object.keys(cronJobs);
  if (aliasList.length > 0) {
    const aliasSelector = { alias: { $in: aliasList } };

    const now = new Date();
    const staleThreshold = new Date(now.getTime() - LOCK_STALE_THRESHOLD);

    // Find existing locks that are still active (not stale)
    const activeLocks = await cronJobsCollection.fetch({
      ...aliasSelector,
      'lock.containerId': { $exists: true },
      'lock.lastHeartbeat': { $gte: staleThreshold },
    });

    const activeLockedAliases = new Set(activeLocks.map((record) => record.alias));

    // TODO: handle different application versions with different parameters for the same job alias

    const lockDate = new Date();

    // Try to acquire locks for each job
    await Promise.all(
      aliasList.map(async (alias) => {
        if (activeLockedAliases.has(alias)) {
          // There's an active instance holding this lock, DO NOT take it over
          // The active instance will continue running this job
          console.log(`Cron job '${alias}' is already locked by another active instance`);
        } else {
          // No active lock (either doesn't exist or is stale), safe to acquire
          await cronJobsCollection.upsertOne(
            { alias },
            {
              $setOnInsert: {
                alias,
                lock: {
                  containerId,
                  acquireDate: lockDate,
                  lastHeartbeat: lockDate,
                },
              },
              $set: {
                lock: {
                  containerId,
                  acquireDate: lockDate,
                  lastHeartbeat: lockDate,
                },
              },
            }
          );
        }
      })
    );

    const cronJobRecords = await cronJobsCollection.fetch(aliasSelector);
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

    cronJobsInterval = setInterval(tickCronJobs, time.seconds(1));
    setInterval(updateLockHeartbeats, LOCK_HEARTBEAT_INTERVAL);
  }
}


/**
 * Updates the heartbeat timestamp for all locks owned by this container
 */
async function updateLockHeartbeats() {
  const aliasList = Object.keys(cronJobs);
  if (aliasList.length === 0) {
    return;
  }

  await cronJobsCollection.updateMany(
    {
      alias: { $in: aliasList },
      'lock.containerId': containerId,
    },
    {
      $set: {
        'lock.lastHeartbeat': new Date(),
      },
    }
  );
}

/**
 * Verifies that this container owns the lock for a specific job
 */
async function verifyJobLock(alias: string): Promise<boolean> {
  const record = await cronJobsCollection.findOne({
    alias,
    'lock.containerId': containerId,
  });
  console.log("record", record);
  return record !== null;
}

/**
 * Checks if this container still owns the lock for the given job.
 * Also attempts to acquire locks that have become stale (from crashed instances).
 */
async function verifyAndAcquireLocks() {
  const aliasList = Object.keys(cronJobs);
  if (aliasList.length === 0) {
    return;
  }

  const now = new Date();
  const staleThreshold = new Date(now.getTime() - LOCK_STALE_THRESHOLD);

  // Find jobs where we don't own the lock but the lock is stale (crashed instance)
  const jobRecords = await cronJobsCollection.fetch({
    alias: { $in: aliasList },
    'lock.containerId': { $ne: containerId },
    'lock.lastHeartbeat': { $lt: staleThreshold },
  });

  // Try to acquire stale locks
  for (const record of jobRecords) {
    const job = cronJobs[record.alias];
    if (!job) {
      continue;
    }

    // Attempt to acquire the lock
    const result = await cronJobsCollection.updateOne(
      {
        alias: record.alias,
        'lock.containerId': { $ne: containerId },
        'lock.lastHeartbeat': { $lt: staleThreshold },
      },
      {
        $set: {
          lock: {
            containerId,
            acquireDate: now,
            lastHeartbeat: now,
          },
        },
      }
    );

    if (result.modifiedCount > 0) {
      console.log(`Acquired stale lock for cron job '${record.alias}'`);

      // Reset job state since we're taking over
      job.state.isRunning = false;
      job.state.startTs = undefined;

      // Reschedule based on last start date or now
      job.state.scheduledRunTs = record.lastStartDate
        ? record.lastStartDate.getTime() + job.params.interval
        : now.getTime();
    }
  }
}

async function tickCronJobs() {
  // Periodically verify locks and acquire stale ones
  await verifyAndAcquireLocks();

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
      // Verify we still own the lock before starting the job
      const ownsLock = await verifyJobLock(job.alias);
      console.log("ownsLock", ownsLock);
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

  // Update the database to record job start before executing
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
