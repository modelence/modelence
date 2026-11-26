import { authenticateCli } from './auth';
import { clearCachedToken } from './authCache';
import { rememberToken } from './deploySession';

// A login that isn't tied to a target, saved for the commands that follow.
export async function signIn(host: string, appId: string | undefined): Promise<string> {
  const auth = await authenticateCli(host, { purpose: 'deploy', appId });
  await rememberToken(host, auth.token, auth.expiresAt);
  return auth.token;
}

/*
  After Studio rejected the token. The saved login goes, unless the token came
  from the environment and the saved one wasn't used. Throws `refusal` where
  nobody can sign in.
*/
export async function signInAgain(
  host: string,
  { appId, canSignIn, refusal }: { appId: string | undefined; canSignIn: boolean; refusal: string }
): Promise<string> {
  if (!process.env.MODELENCE_TOKEN) {
    await clearCachedToken(host);
  }
  if (!canSignIn) {
    throw new Error(refusal);
  }
  process.stderr.write('Your login has expired; please sign in again.\n');
  return await signIn(host, appId);
}
