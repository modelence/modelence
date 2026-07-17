// import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';

import { time } from '../time';
import { CronJob, CronJobInputParams } from './types';
import { startTransaction, captureError } from '@/telemetry';
import { Module } from '../app/module';
import { schema } from '../data/types';
import { Store } from '../data/store';
import { acquireLock } from '../lock/helpers';
import { getMongodbUri } from '@/db/client';
import { locksCollection } from '../lock';

const cronJobs: Record<string, CronJob> = {};
let cronJobsInterval: NodeJS.Timeout | null = null;

const CRON_REGISTRATION_STATUS = {
  REGISTERED: 'cron_registered',
  FAILED: 'cron_registration_failed',
} as const;

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
    try {
      await locksCollection.updateOne(
        { _id: 'migrations' },
        { $set: { status: CRON_REGISTRATION_STATUS.REGISTERED } }
      );
    } catch {
      // Swallowed to prevent startup failure
    }
    return;
  }

  try {
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
      await cronJobsCollection.insertMany(insertItems);
    }

    // Signal that cron job registration succeeded. Other instances polling in
    // waitForCronJobsRegistered will see this and stop waiting.
    await locksCollection.updateOne(
      { _id: 'migrations' },
      { $set: { status: CRON_REGISTRATION_STATUS.REGISTERED } }
    );
  } catch (error) {
    try {
      // Signal that cron job registration failed so waiting instances stop
      // polling immediately rather than blocking until the deadline.
      await locksCollection.updateOne(
        { _id: 'migrations' },
        { $set: { status: CRON_REGISTRATION_STATUS.FAILED } }
      );
    } catch {
      // Swallowed to prevent hiding original error
    }
    throw error;
  }
}

async function waitForCronJobsRegistered(aliasList: string[], timeout: number): Promise<void> {
  const deadline = Date.now() + timeout;
  const pollInterval = time.seconds(1);

  while (Date.now() < deadline) {
    const lockDoc = await locksCollection.findOne({ _id: 'migrations' });

    // If there is no active migrations lock at all, the lock-holder has already
    // finished and released the lock document, so registration is complete.
    if (!lockDoc) {
      return;
    }

    // If the lock-holder has finished cron registration (successfully or not),
    // there is no point waiting further.
    if (
      lockDoc.status === CRON_REGISTRATION_STATUS.REGISTERED ||
      lockDoc.status === CRON_REGISTRATION_STATUS.FAILED
    ) {
      if (lockDoc.status === CRON_REGISTRATION_STATUS.FAILED) {
        await logMissingAliasesWarning(aliasList);
      }
      return;
    }

    // Fast-path: all expected aliases are already present in the DB.
    const records = await cronJobsCollection.fetch({ alias: { $in: aliasList } });
    const registeredAliases = new Set(records.map((r) => r.alias));
    if (aliasList.every((alias) => registeredAliases.has(alias))) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  // Timeout expired — some jobs were never registered by the lock-holder.
  await logMissingAliasesWarning(aliasList);
}

async function logMissingAliasesWarning(aliasList: string[]): Promise<void> {
  const records = await cronJobsCollection.fetch({ alias: { $in: aliasList } });
  const registeredAliases = new Set(records.map((r) => r.alias));
  const missingAliases = aliasList.filter((alias) => !registeredAliases.has(alias));
  if (missingAliases.length > 0) {
    console.warn(
      `Timed out or failed waiting for cron job registration. Missing aliases: [${missingAliases.join(', ')}]. ` +
        `These jobs will fall back to immediate scheduling.`
    );
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
      // Wait for the lock-holder to finish registerNewCronJobs() so every
      // instance sees the DB records before scheduling.
      await waitForCronJobsRegistered(aliasList, time.seconds(30));
      const aliasSelector = { alias: { $in: aliasList } };

      const cronJobRecords = await cronJobsCollection.fetch(aliasSelector);
      cronJobRecords.forEach((record) => {
        const job = cronJobs[record.alias];
        if (!job) {
          return;
        }
        job.state.scheduledRunTs = record.lastStartDate
          ? record.lastStartDate.getTime() + job.params.interval
          : now;
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

  Object.values(cronJobs).forEach(async (job) => {
    const { params, state } = job;
    if (state.isRunning) {
      if (state.startTs && state.startTs + params.timeout < now) {
        // TODO: log cron trace timeout error
        state.isRunning = false;
      }
      return;
    }

    // TODO: limit the number of jobs running concurrently

    if (state.scheduledRunTs && state.scheduledRunTs <= now) {
      await runCronJob(job);
    }
  });
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
