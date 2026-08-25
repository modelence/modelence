import { getConfig } from '../config/server';

/*
  True only for a dev server with no backend at all: not connected to a
  Modelence Cloud environment (no MODELENCE_SERVICE_ENDPOINT — it comes from
  .modelence.env, which is gitignored, so this is the state of every fresh
  clone) and no local database configured either. The client then shows setup
  instructions instead of the app (see client/SetupScreen).

  NODE_ENV is the gate, set explicitly by `modelence dev` / `modelence start`:
  outside development this is always false, so a production misconfiguration
  surfaces as an error rather than setup instructions to end users.
*/
export function isSetupRequired(): boolean {
  return (
    process.env.NODE_ENV === 'development' &&
    !process.env.MODELENCE_SERVICE_ENDPOINT &&
    !getConfig('_system.mongodbUri')
  );
}
