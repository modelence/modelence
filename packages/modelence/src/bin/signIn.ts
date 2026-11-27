import {
  authenticateCli,
  DeadCodeError,
  pollForToken,
  startSignIn,
  type CliAuthOptions,
  type CliAuthResult,
} from './auth';
import {
  clearPendingSignIn,
  pendingSignInKey,
  readPendingSignIn,
  writeLogin,
  writePendingSignIn,
  type AppRef,
  type CachedLogin,
} from './authCache';
import { canWaitForSignIn } from './terminal';

/*
  The login `modelence deploy` and the environment commands use: one app,
  and what the terminal may do in each of its environments, approved once in
  the browser and saved for 30 days.

  With a person at the terminal, the command opens the browser and waits.
  In an agent's shell nobody sees a link while the command runs, so it
  prints the link and stops instead; the agent passes the link on and runs
  the same command again, which collects the token once it is approved.
*/

// A pending sign-in is collected only while Studio still has its code; this
// only bounds how long a forgotten one is kept around.
const PENDING_SIGN_IN_MS = 30 * 60 * 1000;

// Why the command stopped at a link: a first one, the same one again, or a new one.
type SignInPrompt = 'new' | 'waiting' | 'expired';

const SIGN_IN_LEADS: Record<SignInPrompt, (url: string, code: string) => string> = {
  new: () => 'Nobody is watching this terminal for the sign-in, so the command stopped here.',
  waiting: (url, code) => `Still waiting for the sign-in at ${url} (code ${code}).`,
  expired: () => 'The previous sign-in link expired before it was used; this is a new one.',
};

// Without a person watching: approve in the browser, then run the command again.
export class SignInRequiredError extends Error {
  constructor(
    public readonly verificationUrl: string,
    code: string,
    prompt: SignInPrompt
  ) {
    super(
      `${SIGN_IN_LEADS[prompt](verificationUrl, code)} Open the link and approve it, then run the same command again.`
    );
    this.name = 'SignInRequiredError';
  }
}

export interface SignInRequest {
  app: AppRef;
  // The environment the command targets, preselected (or offered to create) on the page.
  envAlias?: string;
  // What modelence.config.json declares, so a new environment is sized for all of it.
  services?: string[];
}

export async function signIn(
  host: string,
  { app, envAlias, services }: SignInRequest
): Promise<CachedLogin> {
  const options: CliAuthOptions = {
    purpose: 'cli',
    appId: app.appId,
    services,
    hint: {
      ...(app.appAlias ? { appAlias: app.appAlias } : {}),
      ...(envAlias ? { envAlias } : {}),
    },
  };
  if (canWaitForSignIn()) {
    return await saveLogin(host, app, await authenticateCli(host, options));
  }

  const key = pendingSignInKey(process.cwd(), app);
  const pending = await readPendingSignIn(host, key);
  if (pending) {
    const auth = await pollPending(host, pending.code, pending.codeVerifier);
    if (auth) {
      await clearPendingSignIn(host, key);
      return await saveLogin(host, app, auth);
    }
    if (auth === null) {
      process.stderr.write(`Sign in to Modelence Cloud: ${pending.verificationUrl}\n`);
      throw new SignInRequiredError(pending.verificationUrl, pending.code, 'waiting');
    }
  }

  const started = await startSignIn(host, options);
  await writePendingSignIn(host, key, {
    ...started,
    expiresAt: new Date(Date.now() + PENDING_SIGN_IN_MS).toISOString(),
  });
  throw new SignInRequiredError(started.verificationUrl, started.code, pending ? 'expired' : 'new');
}

// The token, null while still pending, undefined once the code is gone.
async function pollPending(
  host: string,
  code: string,
  codeVerifier: string | undefined
): Promise<CliAuthResult | null | undefined> {
  try {
    return await pollForToken(host, code, codeVerifier);
  } catch (error) {
    if (error instanceof DeadCodeError) {
      return undefined;
    }
    throw error;
  }
}

/*
  The page lets the person pick another app than the one the command named
  (or none was named). That login is still saved, but a command for this
  project's app can't use it.
*/
async function saveLogin(host: string, app: AppRef, auth: CliAuthResult): Promise<CachedLogin> {
  if (!auth.login) {
    throw new Error(
      'This Modelence Studio does not support CLI logins for an app yet. Use an older version of the CLI with it.'
    );
  }
  const login: CachedLogin = {
    token: auth.token,
    // Studios before expiry was reported: an hour.
    expiresAt: auth.expiresAt ?? new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    appId: auth.login.appId,
    appAlias: auth.login.appAlias,
    environments: auth.login.environments.map(({ alias, access }) => ({ alias, access })),
  };
  await writeLogin(host, login).catch((error: unknown) => {
    console.warn('Could not save the login for next time:', error);
  });
  const named = app.appId ?? app.appAlias;
  if (named && named !== login.appId && named !== login.appAlias) {
    throw new Error(
      `You signed in to the app ${login.appAlias}, but this command is for ${app.appAlias ?? 'the app in .modelence/project.json'}. Run it again and choose that app.`
    );
  }
  return login;
}

/*
  After Studio rejected the login: it expired, was revoked, or doesn't cover
  this environment or the change asked for (Studio's `reason` says which).
  The saved login stays until a new one replaces it: one that only reads
  production still works for staging. Throws `refusal` where nobody can
  sign in.
*/
export async function signInAgain(
  host: string,
  {
    app,
    envAlias,
    canSignIn,
    refusal,
    reason,
  }: SignInRequest & { canSignIn: boolean; refusal: string; reason?: string }
): Promise<string> {
  if (!canSignIn) {
    throw new Error(reason ? `${reason} ${refusal}` : refusal);
  }
  process.stderr.write(`${reason ?? 'Your login has expired.'} Signing in again.\n`);
  return (await signIn(host, { app, envAlias })).token;
}
