import { addCronJob } from './jobs';
import { CronJob, CronJobInputParams } from './types';

export async function defineCronJob(alias: string, params: CronJobInputParams, handler: CronJob['handler']) {
  return await addCronJob(alias, params, handler);
}
