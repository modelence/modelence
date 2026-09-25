import { loadRuntimeEnv, type ProcessEnv } from './env';
import { log } from './log';
import { prepareMounts } from './mounts';
import { killApp, runStartCommand, waitForApp } from './process';
import { startRouter } from './router';
import { readWebSpec, WEB_SPEC_ENV_NAME } from './spec';

// Where the app listens when the router owns PORT.
const DEFAULT_APP_PORT = 3001;
// How long the app behind the router gets to open its port.
const DEFAULT_APP_START_TIMEOUT_SECONDS = 300;

/*
  Frameworks that bind to $HOSTNAME (Next.js standalone) would otherwise
  listen on the container's own hostname and never answer on localhost or
  the task address. A value set in the dashboard still wins.
*/
const APP_HOSTNAME = '0.0.0.0';

/*
  Starts an app on Modelence Cloud from the web part of its app spec
  (MODELENCE_WEB). Depending on what that holds:

    start only         — pulls the environment's variables with the service
                         token, exports them and runs the start command on
                         PORT. A Modelence-framework app is this case too:
                         it gets its variables here and still connects to
                         Studio itself for its configuration.
    static only        — serves the mounted directories on PORT, with
                         single-page app fallback, so client-only sites
                         deploy untouched.
    start + static     — a small router on PORT: files from the mounts are
                         served directly, everything else is proxied to the
                         app on an internal port, and a 404 from the app for
                         a browser navigation falls back to the mount's
                         index.html. One container, one origin, no CORS.
*/
export async function run(env: ProcessEnv = process.env, cwd = process.cwd()): Promise<void> {
  const web = readWebSpec(env);
  if (!web) {
    log(`${WEB_SPEC_ENV_NAME} is not set or not valid JSON`);
    process.exit(1);
  }
  const port = Number(env.PORT) || 3000;
  const mounts = prepareMounts(web.static, cwd);

  if (!web.start) {
    if (mounts.length === 0) {
      log('Nothing to run: no start command and no static directories');
      process.exit(1);
    }
    startRouter(mounts, port, null);
    return;
  }

  const appEnv = await loadRuntimeEnv({ ...env, HOSTNAME: APP_HOSTNAME });
  if (mounts.length === 0) {
    log('Starting: ' + web.start);
    runStartCommand(web.start, appEnv);
    return;
  }

  const appPort = Number(env.MODELENCE_APP_PORT) || DEFAULT_APP_PORT;
  log(`Starting on port ${appPort}: ${web.start}`);
  const app = runStartCommand(web.start, { ...appEnv, PORT: String(appPort) });
  const timeoutSeconds =
    Number(env.MODELENCE_APP_START_TIMEOUT) || DEFAULT_APP_START_TIMEOUT_SECONDS;
  if (!(await waitForApp(appPort, timeoutSeconds * 1000))) {
    log(
      `The app did not accept connections on 127.0.0.1:${appPort} within ${timeoutSeconds}s. ` +
        `It must listen on the port in the PORT variable (${appPort} here), on 0.0.0.0 or 127.0.0.1.`
    );
    killApp(app);
    process.exit(1);
  }
  startRouter(mounts, port, appPort);
}
