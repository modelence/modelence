import { Counter, Histogram, metrics } from '@opentelemetry/api';

type CallAttributes = {
  handler_type: 'loader' | 'action';
  handler: string;
};

let callCounter: Counter<CallAttributes> | null = null;
let callDuration: Histogram<CallAttributes> | null = null;

export function initCallMetrics() {
  const callMeter = metrics.getMeter('modelence_call');
  callCounter = callMeter.createCounter<CallAttributes>('modelence_call_total', {
    description: 'The number of times a loader/action was invoked',
  });
  callDuration = callMeter.createHistogram<CallAttributes>('modelence_call_duration_seconds', {
    description: 'The duration of loader/action processing time in seconds',
    unit: 's',
  });
}

export function recordLoaderCall(handler: string) {
  callCounter?.add(1, {
    handler_type: 'loader',
    handler,
  });
}

export function recordLoaderResponse(handler: string, durationMs: number) {
  const duration = durationMs / 1000;
  callDuration?.record(duration, {
    handler_type: 'loader',
    handler,
  });
}
