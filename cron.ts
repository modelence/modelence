import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';

import { time } from './time';

interface CronJob {
  alias: string;
  interval: number;
  filePath: string;
  timeout: number;
}

const cronJobs: Record<string, CronJob> = {};
const DEFAULT_TIMEOUT = time.minutes(10);

export function createCronJob(
  alias: CronJob['alias'],
  interval: CronJob['interval'],
  filePath: CronJob['filePath'],
  { timeout = DEFAULT_TIMEOUT }: { timeout?: CronJob['timeout'] } = {}
) {
  if (cronJobs[alias]) {
    throw new Error(`Duplicate cron job declaration: '${alias}' already exists`);
  }

  cronJobs[alias] = { alias, interval, filePath, timeout };
  const runCronJob = () => {
    const worker = new Worker(filePath, {
      workerData: {},
      execArgv: ['--loader', 'tsx'],
    });

    // const timeoutId = setTimeout(() => {
    //   worker.terminate();
    //   console.error(`Cron job '${alias}' timed out after ${timeout}ms`);
    // }, timeout);

    // worker.on('message', (message) => {
    //   if (message === 'done') {
    //     clearTimeout(timeoutId);
    //     worker.terminate();
    //   }
    // });

    // worker.on('error', (err) => {
    //   clearTimeout(timeoutId);
    //   console.error(`Error in cron job '${alias}':`, err);
    // });

    worker.on('exit', (code) => {
      console.error(`Cron job '${alias}' exited with code ${code}`);
      setTimeout(runCronJob, interval);
    });
  };

  runCronJob();
}
