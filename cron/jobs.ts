// import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';

import { time } from '../time';
import { MongoCollection } from '../db/MongoCollection';
import { getClient } from '../db/client';
import { CronJob, CronJobInputParams } from './types';

const cronJobs: Record<string, CronJob> = {};
const DEFAULT_TIMEOUT = time.minutes(1);
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

  if (interval < time.seconds(1)) {
    throw new Error(`Cron job interval should not be less than 1 second [${alias}]`);
  }

  if (timeout > time.days(1)) {
    throw new Error(`Cron job timeout should not be longer than 1 day [${alias}]`);
  }

  cronJobs[alias] = { alias, params: { interval, timeout }, handler };
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
  // rawCollection.createIndex({  });
  const cronJobRecords = await cronJobsCollection.find({});
  // TODO: populate lock dates from the records
  // cronJobRecords.forEach((record) => {
  //   cronJobs[job.alias] = job;
  // });

  cronJobsInterval = setInterval(tickCronJobs, time.seconds(1));
}

function tickCronJobs() {
  Object.values(cronJobs).forEach(({ alias, params, handler }) => {
    
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
