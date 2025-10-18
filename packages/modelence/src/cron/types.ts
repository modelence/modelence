type CronJobHandler = () => Promise<void>;

export type CronJob = {
  alias: string;
  params: {
    description: string;
    interval: number;
    timeout: number;
  };
  handler: CronJobHandler;
  state: {
    startTs?: number;
    scheduledRunTs?: number;
    isRunning: boolean;
  };
};

export type CronJobInputParams = {
  description?: string;
  interval: number;
  timeout?: number;
  handler: CronJobHandler;
};

export type CronJobMetadata = {
  alias: string;
  description: string;
  interval: number;
  timeout: number;
};
