// import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';

import { time } from '../time';
import { CronJob, CronJobInputParams } from './types';
import { startTransaction, captureError } from '@/telemetry';
import { Module } from '../app/module';
import { schema } from '../data/types';
import { Store } from '../data/store';
import { acquireLock } from '../lock/helpers';
import { getMongodbUri } from '@/db/client';
import { isDuplicateKeyError } from '../lock';

const cronJobs: Record<string, CronJob> = {};
let cronJobsInterval: NodeJS.Timeout | null = null;

const cronJobsCollection = new Store('_modelenceCronJobs', {
  schema: {
    alias: schema.string(),
    lastStartDate: schema.date().optional(),
  },
  indexes: [{ key: { alias: 1 }, unique: true }],
  indexCreationMode: 'blocking',
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

/**
 * Registers newly defined cron jobs in the database (If MongoDB Client Connected).
 *
 * This function initializes the database registry for all cron jobs defined
 * in the application. It compares the application's cron job definitions against
 * the database records and inserts only those that haven't been registered yet.
 * This prevents duplicate entries and maintains an audit trail of when each
 * cron job was first scheduled.
 */
export async function registerNewCronJobs() {
  const aliasList = Object.keys(cronJobs);
  if (aliasList.length === 0) {
    return;
  }

  // This read-then-insert pattern is safe because it
  // only runs under the migrations lock (see createIndexesAndMigrationsWithLock).
  // If this registerNewCronJobs is ever called without migrations lock, the ordered insertMany would abort on a
  // duplicate-key error from the unique alias index.
  const aliasSelector = { alias: { $in: aliasList } };
  const existingCronJobs = await cronJobsCollection.fetch(aliasSelector);
  const existingCronJobAliases = new Set(existingCronJobs.map((job) => job.alias));

  const insertItems = Object.values(cronJobs)
    .filter((job) => !existingCronJobAliases.has(job.alias))
    .map((job) => ({
      alias: job.alias,
    }));

  if (insertItems.length > 0) {
    try {
      await cronJobsCollection.requireCollection().insertMany(insertItems, { ordered: false });
    } catch (error) {
      if (!isDuplicateKeyError(error)) {
        throw error;
      }
    }
  }
}

export async function startCronJobs() {
  if (cronJobsInterval) {
    throw new Error('Cron jobs already started');
  }

  const aliasList = Object.keys(cronJobs);
  if (aliasList.length > 0) {
    const now = Date.now();

    if (getMongodbUri()) {
      const aliasSelector = { alias: { $in: aliasList } };
      const cronJobRecords = await cronJobsCollection.fetch(aliasSelector);
      cronJobRecords.forEach((record) => {
        const job = cronJobs[record.alias];
        if (!job) {
          return;
        }
        const recordRunTs = record.lastStartDate
          ? record.lastStartDate.getTime() + job.params.interval
          : now;
        if (!job.state.scheduledRunTs || recordRunTs > job.state.scheduledRunTs) {
          job.state.scheduledRunTs = recordRunTs;
        }
      });
    }

    // Any jobs not yet scheduled (either no Mongo, or no DB record) run immediately.
    Object.values(cronJobs).forEach((job) => {
      if (!job.state.scheduledRunTs) {
        job.state.scheduledRunTs = now;
      }
    });

    cronJobsInterval = setInterval(tickCronJobs, time.seconds(1));
  }
}

async function tickCronJobs() {
  const now = Date.now();

  const ownsLock = await acquireLock('cron', {
    successfulLockCacheDuration: time.seconds(10),
    failedLockCacheDuration: time.seconds(30),
  });

  if (!ownsLock) {
    return;
  }

  for (const job of Object.values(cronJobs)) {
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
      await runCronJob(job);
    }
  }
}

async function runCronJob(job: CronJob) {
  const { alias, params, handler, state } = job;
  state.isRunning = true;
  state.startTs = Date.now();

  await cronJobsCollection.upsertOne(
    { alias },
    {
      $set: { lastStartDate: new Date(state.startTs) },
      $setOnInsert: { alias },
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
