// import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';

import { time } from '../time';
import { MongoCollection } from '../db/MongoCollection';
import { getClient } from '../db/client';
import { CronJob, CronJobInputParams } from './types';

const DEFAULT_TIMEOUT = time.minutes(1);

/**
 * Each cron instance acquires locks for the jobs it runs. If there was a pre-existing lock,
 * the lock is transferred to the new instance, but there is a delay to give the previous instance
 * a chance to see the new lock and gracefully finish remaining jobs.
 */
const LOCK_TRANSFER_DELAY = time.seconds(10);

const cronJobs: Record<string, CronJob> = {};
let cronJobsCollection: MongoCollection;

let cronJobsInterval: NodeJS.Timeout;

export function addCronJob(
  alias: CronJob['alias'],
  { interval, timeout = DEFAULT_TIMEOUT }: CronJobInputParams,
  handler: CronJob['handler'],
) {
  if (cronJobs[alias]) {
    throw new Error(`Duplicate cron job declaration: '${alias}' already exists`);
  }

  if (interval < time.seconds(5)) {
    throw new Error(`Cron job interval should not be less than 5 second [${alias}]`);
  }

  if (timeout > time.days(1)) {
    throw new Error(`Cron job timeout should not be longer than 1 day [${alias}]`);
  }

  cronJobs[alias] = {
    alias,
    params: { interval, timeout },
    handler,
    state: {
      isRunning: false,
    }
  };
}

export async function startCronJobs() {
  if (cronJobsInterval) {
    throw new Error('Cron jobs already started');
  }

  const client = getClient();
  if (!client) {
    throw new Error('Failed to start cron jobs: MongoDB client not initialized');
  }

  const rawCollection = client.db().collection('_modelenceCronJobs');
  cronJobsCollection = new MongoCollection(rawCollection);
  rawCollection.createIndex({ alias: 1 }, { unique: true });

  const aliasList = Object.keys(cronJobs);
  const aliasSelector = { alias: { $in: aliasList } };

  const existingLockedRecord = await cronJobsCollection.findOne({
    ...aliasSelector,
    'lock.containerId': { $exists: true }
  });

  await cronJobsCollection.updateMany(
    aliasSelector,
    {
      $set: {
        lock: {
          containerId: process.env.MODELENCE_CONTAINER_ID,
          acquireDate: new Date(),
        }
      }
    }
  );

  if (existingLockedRecord) {
    await sleep(LOCK_TRANSFER_DELAY);
  }

  const cronJobRecords = await cronJobsCollection.fetch(aliasSelector);
  const now = Date.now();
  cronJobRecords.forEach((record) => {
    const job = cronJobs[record.alias];
    if (!job) {
      return;
    }
    job.state.scheduledRunTs = record.lastStartDate ? record.lastStartDate.getTime() + job.params.interval : now;
  });
  Object.values(cronJobs).forEach((job) => {
    if (!job.state.scheduledRunTs) {
      job.state.scheduledRunTs = now;
    }
  });

  cronJobsInterval = setInterval(tickCronJobs, time.seconds(1));
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function tickCronJobs() {
  // TODO: periodically check if the locks are still there

  const now = Date.now();
  Object.values(cronJobs).forEach(({ alias, params, handler, state }) => {
    if (state.isRunning) {
      if (state.startTs && state.startTs + params.timeout < now) {
        // TODO: log cron trace timeout error
        state.isRunning = false;
      }
      return;
    }

    // TODO: limit the number of jobs running concurrently

    if (state.scheduledRunTs && state.scheduledRunTs <= now) {
      state.isRunning = true;
      state.startTs = now;
      // TODO: log cron trace start
      // TODO: enforce job timeout
      handler().then(() => {
        state.scheduledRunTs = state.startTs ? state.startTs + params.interval : now;
        state.startTs = undefined;
        state.isRunning = false;
        // TODO: log cron trace success
      }).catch((err) => {
        state.scheduledRunTs = state.startTs ? state.startTs + params.interval : now;
        state.startTs = undefined;
        state.isRunning = false;
        console.error(`Error in cron job '${alias}':`, err);
        // TODO: log cron trace error
      });
    }
  });
}

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
