type AppMetadata = {
  environmentId: string;
  appAlias: string;
  environmentAlias: string;
  telemetry: {
    isEnabled: boolean;
    serviceName: string;
  };
};

let appStarted = false;
let metadata: AppMetadata | null = null;

export function markAppStarted() {
  appStarted = true;
}

export function isAppStarted() {
  return appStarted;
}

export function setMetadata(_metadata: AppMetadata) {
  metadata = Object.assign({}, metadata, _metadata);
}

export function getEnvironmentId() {
  return metadata?.environmentId;
}

export function getAppAlias() {
  return metadata?.appAlias;
}

export function getEnvironmentAlias() {
  return metadata?.environmentAlias;
}

export function getTelemetryServiceName() {
  return metadata?.telemetry?.serviceName;
}

export function isTelemetryEnabled() {
  return Boolean(metadata?.telemetry?.isEnabled);
}
