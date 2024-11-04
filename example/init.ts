import { defineCronJob } from 'modelence/cron';
import { time } from 'modelence/time';

export async function init() {
  defineCronJob('heartbeat', time.seconds(5), './heartbeat.cron.ts');
}
