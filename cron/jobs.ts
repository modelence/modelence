// import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';

import { time } from '../time';
import { CronJob, CronJobInputParams } from './types';
import { startTransaction, captureError } from '../app/metrics';
import { Module } from '../app/module';
import { schema } from '../data/types';
import { Store } from '../data/store';

const DEFAULT_TIMEOUT = time.minutes(1);

/**
 * Each cron instance acquires locks for the jobs it runs. If there was a pre-existing lock,
 * the lock is transferred to the new instance, but there is a delay to give the previous instance
 * a chance to see the new lock and gracefully finish remaining jobs.
 */
const LOCK_TRANSFER_DELAY = time.seconds(10);

const cronJobs: Record<string, CronJob> = {};
let cronJobsInterval: NodeJS.Timeout;

// TODO: get rid of, directly infer from schema
type DataType = {
  alias: string;
  lastStartDate?: Date;
  lock?: {
    containerId: string;
    acquireDate: Date;
  };
};

const cronJobsCollection = new Store<DataType>('_modelenceCronJobs', {
  schema: {
    alias: schema.string(),
    lastStartDate: schema.date(),
    lock: schema.object({}),
  },
  indexes: [
    { key: { alias: 1 }, unique: true, background: true },
  ]
});

// TODO: allow changing interval and timeout with cron jobconfigs
export function defineCronJob(
  alias: CronJob['alias'],
  { description = '', interval, timeout = DEFAULT_TIMEOUT, handler }: CronJobInputParams,
) {
  if (cronJobs[alias]) {
    throw new Error(`Duplicate cron job declaration: '${alias}' already exists`);
  }

  if (cronJobsInterval) {
    throw new Error(`Unable to add a cron job - cron jobs have already been initialized: [${alias}]`);
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
    }
  };
}

export async function startCronJobs() {
  if (cronJobsInterval) {
    throw new Error('Cron jobs already started');
  }

  const aliasList = Object.keys(cronJobs);
  const aliasSelector = { alias: { $in: aliasList } };

  const existingLockedRecord = await cronJobsCollection.findOne({
    ...aliasSelector,
    'lock.containerId': { $exists: true }
  });

  // TODO: handle different application versions with different parameters for the same job alias

  await cronJobsCollection.upsertMany(
    aliasSelector,
    {
      $set: {
        lock: {
          containerId: process.env.MODELENCE_CONTAINER_ID || 'unknown',
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
      await startCronJob(job);
    }
  });
}

async function startCronJob(job: CronJob) {
  const { alias, params, handler, state } = job;
  state.isRunning = true;
  state.startTs = Date.now();
  const transaction = startTransaction('cron', `cron:${alias}`);
  // TODO: enforce job timeout
  handler().then(() => {
    handleCronJobCompletion(state, params);
    transaction.end('success');
  }).catch((err) => {
    handleCronJobCompletion(state, params);
    captureError(err);
    transaction.end('error');
    console.error(`Error in cron job '${alias}':`, err);
  });
  await cronJobsCollection.updateOne({ alias }, {
    $set: {
      lastStartDate: new Date(state.startTs),
    }
  });
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
