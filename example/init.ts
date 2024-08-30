import { createCronJob } from 'modelence/cron';
import { time } from 'modelence/time';

export async function init() {
  createCronJob('heartbeat', time.seconds(5), './heartbeat.cron.ts');
}
