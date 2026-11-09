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
    lastTimeoutReportTs?: number;
    isRunning: boolean;
  };
};

export type CronJobInputParams = {
  description?: string;
  interval: number;
  /**
   * How long a run may take, in milliseconds, before an error is reported. The error repeats
   * every `timeout` until the run finishes.
   *
   * This only reports: nothing aborts the handler, and the job won't run again until it settles.
   * A handler that never settles blocks its job until the process restarts, so give any network
   * or database calls in it their own timeouts.
   */
  timeout?: number;
  handler: CronJobHandler;
};

export type CronJobMetadata = {
  alias: string;
  description: string;
  interval: number;
  timeout: number;
};
