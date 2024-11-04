export type CronJobInputParams = {
  interval: number;
  timeout?: number;
}

export type CronJob = {
  alias: string;
  params: {
    interval: number;
    timeout: number;
  },
  handler: () => Promise<void>;
}
