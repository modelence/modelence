let appStarted = false;

export function markAppStarted() {
  appStarted = true;
}

export function isAppStarted() {
  return appStarted;
}
