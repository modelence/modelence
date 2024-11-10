export type CronJob = {
  alias: string;
  params: {
    description: string;
    interval: number;
    timeout: number;
  },
  handler: () => Promise<void>;
  state: {
    startTs?: number;
    scheduledRunTs?: number;
    isRunning: boolean;
  }
}

export type CronJobInputParams = {
  description?: string;
  interval: number;
  timeout?: number;
}

export type CronJobMetadata = {
  alias: string;
  description: string;
  interval: number;
  timeout: number;
}
